import type { InProcessBus } from './bus.js';
import { MessageBus$ } from './bus.js';
import { portsConfigKeys } from './config.js';
import { makeContract } from './contract.js';
import type { Emitter, Port } from './families.js';
import { EmitterFamily, PortFamily } from './families.js';
import { implement } from './implement.js';
import { bindPorts, portsKernel } from './kernel.js';
import { collectImplementations } from './topology.js';
import { BusTransport$ } from './transport.js';

import { configKernel, objectSource } from '@nestling/config';
import type { BuiltContainer } from '@nestling/container';
import {
  ContainerBuilder,
  factoryProvider,
  makeToken,
} from '@nestling/container';
import type { AnyEndpointDefinition, TransportRef } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const Echo = makeContract({
  name: 'kernel.echo',
  kind: 'request',
  input: z.object({ items: z.array(z.number()) }),
  output: z.object({ received: z.array(z.number()) }),
});

const Unused = makeContract({
  name: 'kernel.unused',
  kind: 'request',
  output: z.object({ ok: z.boolean() }),
});

const Orphan = makeContract({
  name: 'kernel.orphan',
  kind: 'request',
  output: z.object({ ok: z.boolean() }),
});

const Placed = makeContract({
  name: 'kernel.placed',
  kind: 'event',
  input: z.object({ id: z.string() }),
});

/**
 * Контракт без `input`-схемы: на нём видно, копируется payload или нет.
 *
 * У контракта со схемой хендлер получает **выход схемы** — новый объект на
 * обоих путях, потому что валидация входа обязательна для обоих (см.
 * capability `port-invocation`). Разницу «копия против ссылки» показывает
 * только тот случай, где валидировать нечем.
 */
const Passthrough = makeContract({
  name: 'kernel.passthrough',
  kind: 'request',
  output: z.object({ ok: z.boolean() }),
});

let receivedPayload: unknown;

const EchoImpl = implement(Echo, {
  handle: async (input) => {
    receivedPayload = input;

    return new Ok({ received: input.items });
  },
});

const PassthroughImpl = implement(Passthrough, {
  handle: async (payload) => {
    receivedPayload = payload;

    return new Ok({ ok: true });
  },
});

const Consumer = makeToken<{ port: Port<any> }>('Consumer');
const EventConsumer = makeToken<{ emitter: Emitter<any> }>('EventConsumer');

interface Assembled {
  container: BuiltContainer;
  bus?: InProcessBus;
  close: () => Promise<void>;
}

/**
 * Мини-корень: те же шаги, что делает `App` в фазах ASSEMBLE и WIRE, но без
 * зависимости от `@nestling/app` (стрелка зависимостей идёт оттуда сюда).
 */
async function assemble(options: {
  declarations?: readonly AnyEndpointDefinition[];
  consumers?: readonly Parameters<ContainerBuilder['register']>[0][];
  dispatch?: 'local-first' | 'always-remote';
  wire?: boolean;
}): Promise<Assembled> {
  const declarations = options.declarations ?? [];
  const source = objectSource(
    options.dispatch === undefined
      ? {}
      : { NESTLING_PORTS_DISPATCH: options.dispatch },
  );

  const builder = new ContainerBuilder();
  builder.register(configKernel([[source, portsConfigKeys]]));
  builder.register(
    portsKernel({
      implementations: collectImplementations(
        declarations.map((endpoint) => ({
          endpoint,
          moduleName: 'module:test',
        })),
      ),
      onPortFailure: () => {
        /* отказы вызывателей проверяются отдельными тестами */
      },
      bus: {
        onDeliveryFailure: () => {
          /* доставка молчит: тест смотрит на биндинг */
        },
      },
    }),
  );

  for (const consumer of options.consumers ?? []) {
    builder.register(consumer);
  }

  const container = await builder.build();
  const bus = container.get(MessageBus$) as InProcessBus | null;

  if (options.wire === false) {
    return {
      container,
      ...(bus === null ? {} : { bus }),
      close: async () => bus?.close(),
    };
  }

  const dispatch = makeDispatch(
    declarations.map((declaration) =>
      declaration.resolve((token) => container.get(token) ?? undefined),
    ),
  );

  const dispatches = new Map<TransportRef, Dispatch>([
    [BusTransport$ as TransportRef, dispatch],
  ]);

  if (bus) {
    await (bus as unknown as ITransport).serve(
      dispatch,
      new AbortController().signal,
    );
  }

  bindPorts(container, dispatches);

  return {
    container,
    ...(bus === null ? {} : { bus }),
    close: async () => bus?.close(),
  };
}

const portConsumer = factoryProvider(
  Consumer,
  (port: Port<any>) => ({ port }),
  [Echo.port],
);

const passthroughConsumer = factoryProvider(
  Consumer,
  (port: Port<any>) => ({ port }),
  [Passthrough.port],
);

describe('portsKernel', () => {
  it('материализует вызыватель только для запрошенных контрактов', async () => {
    const app = await assemble({
      declarations: [EchoImpl],
      consumers: [portConsumer],
    });

    expect(app.container.get(PortFamily(Echo.name))).not.toBeNull();
    expect(app.container.get(PortFamily(Unused.name))).toBeNull();

    await app.close();
  });

  it('приложение без контрактов не заводит ни одного узла портов', async () => {
    const app = await assemble({});

    expect(app.container.get(MessageBus$)).toBeNull();
    expect(app.container.get(BusTransport$)).toBeNull();
    expect(app.container.get(PortFamily(Echo.name))).toBeNull();

    await app.close();
  });

  it('local-first зовёт реализацию без копирования payload', async () => {
    const app = await assemble({
      declarations: [PassthroughImpl],
      consumers: [passthroughConsumer],
      dispatch: 'local-first',
    });

    const { port } = app.container.getOrThrow(Consumer);
    const payload = { items: [1, 2] };
    const result = await port.call(payload);

    expect(result).toBeInstanceOf(Ok);
    expect(receivedPayload).toBe(payload);

    await app.close();
  });

  it('always-remote уводит тот же вызов через шину со структурной копией', async () => {
    const app = await assemble({
      declarations: [PassthroughImpl],
      consumers: [passthroughConsumer],
      dispatch: 'always-remote',
    });

    const { port } = app.container.getOrThrow(Consumer);
    const payload = { items: [1, 2] };
    const result = await port.call(payload);

    expect(result).toBeInstanceOf(Ok);
    expect(receivedPayload).not.toBe(payload);
    expect(receivedPayload).toEqual({ items: [1, 2] });

    await app.close();
  });

  it('отвергает неизвестную политику валидацией секции', async () => {
    await expect(
      assemble({
        declarations: [EchoImpl],
        consumers: [portConsumer],
        dispatch: 'balanced' as never,
      }),
    ).rejects.toThrow(/'local-first', 'always-remote'/);
  });

  it('недостижимый контракт — ошибка сборки', async () => {
    const orphanConsumer = factoryProvider(
      Consumer,
      (port: Port<any>) => ({ port }),
      [Orphan.port],
    );

    await expect(
      assemble({ declarations: [EchoImpl], consumers: [orphanConsumer] }),
    ).rejects.toThrow(/'kernel\.orphan'.*no selected module implements it/s);
  });

  it('эмиттер события без подписчиков легален и доставляет ноль раз', async () => {
    const eventConsumer = factoryProvider(
      EventConsumer,
      (emitter: Emitter<any>) => ({ emitter }),
      [Placed.emitter],
    );

    const app = await assemble({
      declarations: [EchoImpl],
      consumers: [eventConsumer],
    });

    const { emitter } = app.container.getOrThrow(EventConsumer);

    await expect(emitter.emit({ id: 'o-1' })).resolves.toBeUndefined();
    expect(app.container.get(EmitterFamily(Placed.name))).not.toBeNull();

    await app.close();
  });

  it('вызов до фазы WIRE — ошибка с именем контракта и фазой', async () => {
    const app = await assemble({
      declarations: [EchoImpl],
      consumers: [portConsumer],
      wire: false,
    });

    const { port } = app.container.getOrThrow(Consumer);

    await expect(port.call({ items: [1] })).rejects.toThrow(
      /'kernel\.echo' was called before phase 3 WIRE/,
    );

    await app.close();
  });
});
