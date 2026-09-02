/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import type { InProcessBus } from './bus.js';
import { InProcessBus as InProcessBusClass, MessageBus$ } from './bus.js';
import { portsConfigKeys } from './config.js';
import { implement } from './implement.js';
import { bindPorts, portsKernel, undurableOperations } from './kernel.js';
import { collectImplementations } from './topology.js';
import { BusTransport$ } from './transport.js';

import { configKernel, objectSource } from '@nestling/config';
import type { BuiltContainer } from '@nestling/container';
import {
  ContainerBuilder,
  factoryProvider,
  makeToken,
} from '@nestling/container';
import type { Emitter, Port } from '@nestling/contracts';
import {
  EmitterFamily,
  makeEvent,
  makeRequest,
  PortFamily,
} from '@nestling/contracts';
import type { AnyEndpointDefinition, TransportRef } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import type { Dispatch } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const Echo = makeRequest({
  name: 'kernel.echo',
  input: z.object({ items: z.array(z.number()) }),
  output: z.object({ received: z.array(z.number()) }),
});

const Unused = makeRequest({
  name: 'kernel.unused',
  output: z.object({ ok: z.boolean() }),
});

const Orphan = makeRequest({
  name: 'kernel.orphan',
  output: z.object({ ok: z.boolean() }),
});

const Placed = makeEvent({
  name: 'kernel.placed',
  input: z.object({ id: z.string() }),
});

/**
 * Операция без `input`-схемы: на нём видно, копируется payload или нет.
 *
 * У операции со схемой хендлер получает **выход схемы** — новый объект на
 * обоих путях, потому что валидация входа обязательна для обоих (см.
 * capability `port-invocation`). Разницу «копия против ссылки» показывает
 * только тот случай, где валидировать нечем.
 */
const Passthrough = makeRequest({
  name: 'kernel.passthrough',
  output: z.object({ ok: z.boolean() }),
});

let receivedPayload: unknown;

const EchoImpl = implement(Echo, {
  handle: async (input) => {
    receivedPayload = input;

    return new Ok({ received: input.items });
  },
});

const DurablePlaced = makeEvent({
  name: 'kernel.durable.placed',
  durable: true,
  input: z.object({ id: z.string() }),
});

const DurableImpl = implement(DurablePlaced, {
  subscriber: 'billing',
  handle: async () => undefined,
});

const PassthroughImpl = implement(Passthrough, {
  handle: async (payload) => {
    receivedPayload = payload;

    return new Ok({ ok: true });
  },
});

let placedSeen: string[] = [];

const PlacedImpl = implement(Placed, {
  subscriber: 'audit',
  handle: async (input) => {
    placedSeen.push(input.id);

    return undefined;
  },
});

const Consumer = makeToken<{ port: Port<any> }>('Consumer');
const EventConsumer = makeToken<{ emitter: Emitter<any> }>('EventConsumer');

/**
 * Шина, объявившая себя remote.
 *
 * Наследник in-proc шины, а не второй симулятор: биндинг читает
 * **объявленный** признак, а доставка остаётся настоящей — поэтому на этой
 * же шине проверяется и loopback co-located подписчика.
 */
class FakeRemoteBus extends InProcessBusClass {
  override readonly remote: boolean = true;

  readonly published: { subject: string; options?: unknown }[] = [];

  override async publish(
    subject: string,
    payload: unknown,
    options?: Parameters<InProcessBusClass['publish']>[2],
  ): Promise<void> {
    this.published.push({ subject, options });

    return super.publish(subject, payload, options);
  }
}

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
  /** Корень поставил remote-шину — то же, что `nats()` в `transports:` */
  rootBus?: FakeRemoteBus;
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
      ...(options.rootBus === undefined ? {} : { rootSuppliesBus: true }),
    }),
  );

  if (options.rootBus) {
    const rootBus = options.rootBus;
    builder.register(factoryProvider(BusTransport$, () => rootBus, []));
  }

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

  // `bindPorts` — тот же шаг, что делает `App` на WIRE: он и наполняет
  // держатель, и подписывает шину на её маршруты
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
  [Echo.caller],
);

const passthroughConsumer = factoryProvider(
  Consumer,
  (port: Port<any>) => ({ port }),
  [Passthrough.caller],
);

describe('portsKernel', () => {
  beforeEach(() => {
    placedSeen = [];
  });

  it('создаёт вызыватель только для запрошенных операций', async () => {
    const app = await assemble({
      declarations: [EchoImpl],
      consumers: [portConsumer],
    });

    expect(app.container.get(PortFamily(Echo.name))).not.toBeNull();
    expect(app.container.get(PortFamily(Unused.name))).toBeNull();

    await app.close();
  });

  it('приложение без операций не заводит ни одного узла портов', async () => {
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

  it('недостижимый операция — ошибка сборки', async () => {
    const orphanConsumer = factoryProvider(
      Consumer,
      (port: Port<any>) => ({ port }),
      [Orphan.caller],
    );

    await expect(
      assemble({ declarations: [EchoImpl], consumers: [orphanConsumer] }),
    ).rejects.toThrow(/'kernel\.orphan'.*no selected module implements it/s);
  });

  it('эмиттер события без подписчиков не роняет вызов и доставляет ноль раз', async () => {
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

  it('называет операции, обслуживаемые недолговечно', async () => {
    const app = await assemble({ declarations: [DurableImpl, EchoImpl] });

    expect(undurableOperations(app.container, [DurableImpl, EchoImpl])).toEqual(
      ['kernel.durable.placed'],
    );

    await app.close();
  });

  it('без долговечных операций список пуст', async () => {
    const app = await assemble({ declarations: [EchoImpl] });

    expect(undurableOperations(app.container, [EchoImpl])).toEqual([]);

    await app.close();
  });

  it('шина, умеющая долговечность, деградации не даёт', async () => {
    const app = await assemble({ declarations: [DurableImpl] });

    // Способность читается **значением**, а не выводится из класса: тест
    // подменяет её на собранной шине и получает пустой список
    Object.defineProperty(app.container.getOrThrow(MessageBus$), 'durable', {
      value: true,
    });

    expect(undurableOperations(app.container, [DurableImpl])).toEqual([]);

    await app.close();
  });

  it('request без co-located при remote-шине биндится на шину', async () => {
    const orphanConsumer = factoryProvider(
      Consumer,
      (port: Port<any>) => ({ port }),
      [Orphan.caller],
    );

    const rootBus = new FakeRemoteBus({
      onDeliveryFailure: () => {
        /* владельца нет нигде в кластере: тест смотрит на биндинг */
      },
    });

    const app = await assemble({ consumers: [orphanConsumer], rootBus });

    const { port } = app.container.getOrThrow(Consumer);
    const result = await port.call();

    // Сборка прошла, вызов ушёл на шину и вернулся отказом доставки —
    // недоступность владельца это рантайм, а не ошибка компоновки
    expect(result.isFail).toBe(true);

    await app.close();
  });

  it('чистый потребитель собирается: ни одной реализации, но шина есть', async () => {
    const orphanConsumer = factoryProvider(
      Consumer,
      (port: Port<any>) => ({ port }),
      [Orphan.caller],
    );

    const rootBus = new FakeRemoteBus();
    const app = await assemble({ consumers: [orphanConsumer], rootBus });

    expect(app.container.get(PortFamily(Orphan.name))).not.toBeNull();

    await app.close();
  });

  it('шину поставил корень: оба токена дают его инстанс', async () => {
    const rootBus = new FakeRemoteBus();
    const app = await assemble({ declarations: [EchoImpl], rootBus });

    expect(app.container.get(MessageBus$)).toBe(rootBus);
    expect(app.container.get(BusTransport$)).toBe(rootBus);

    await app.close();
  });

  it('событие при remote-шине уходит через шину, доставляясь один раз', async () => {
    const eventConsumer = factoryProvider(
      EventConsumer,
      (emitter: Emitter<any>) => ({ emitter }),
      [Placed.emitter],
    );

    const rootBus = new FakeRemoteBus();
    const app = await assemble({
      declarations: [PlacedImpl],
      consumers: [eventConsumer],
      rootBus,
    });

    const { emitter } = app.container.getOrThrow(EventConsumer);
    await emitter.emit({ id: 'o-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Ровно одна публикация и ровно одна доставка: co-located подписчик
    // получает свою копию loopback'ом, а не вторым локальным dispatch'ем
    expect(rootBus.published.map(({ subject }) => subject)).toEqual([
      'kernel.placed',
    ]);
    expect(placedSeen).toEqual(['o-1']);

    await app.close();
  });

  it('событие при in-proc шине по-прежнему идёт локальным dispatch', async () => {
    const eventConsumer = factoryProvider(
      EventConsumer,
      (emitter: Emitter<any>) => ({ emitter }),
      [Placed.emitter],
    );

    const app = await assemble({
      declarations: [PlacedImpl],
      consumers: [eventConsumer],
    });

    const { emitter } = app.container.getOrThrow(EventConsumer);
    await emitter.emit({ id: 'o-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(placedSeen).toEqual(['o-2']);

    await app.close();
  });

  it('request с co-located реализацией при remote-шине остаётся локальным', async () => {
    const rootBus = new FakeRemoteBus();
    const app = await assemble({
      declarations: [PassthroughImpl],
      consumers: [passthroughConsumer],
      rootBus,
      dispatch: 'local-first',
    });

    const { port } = app.container.getOrThrow(Consumer);
    const payload = { items: [1, 2] };

    expect(await port.call(payload)).toBeInstanceOf(Ok);
    // Ссылка, а не копия: вызов не пересекал шину
    expect(receivedPayload).toBe(payload);

    await app.close();
  });

  it('вызов до фазы WIRE — ошибка с именем операции и фазой', async () => {
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
