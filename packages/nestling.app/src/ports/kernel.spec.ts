/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { objectSource } from '../config/__fixtures__/object-source.js';
import { bind, bootstrapConfig, configKernel } from '../config/index.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';
import { loggerKernel } from '../logger/kernel.js';
import { RootLogger$ } from '../logger/tokens.js';
import type { MetricsProbe } from '../metrics/__fixtures__/probe.js';
import { probeMetrics } from '../metrics/__fixtures__/probe.js';
import {
  KernelMetrics,
  metricsKernel,
  MetricsStore$,
} from '../metrics/index.js';
import { contextKernel } from '../pipeline/core/context/index.js';
import type { AnyEndpointDefinition, TransportRef } from '../pipeline/index.js';
import { Ok } from '../pipeline/index.js';
import type { Dispatch } from '../transport/index.js';
import { makeDispatch } from '../transport/index.js';

import type { InProcessBus } from './bus.js';
import { InProcessBus as InProcessBusClass, MessageBus$ } from './bus.js';
import { portsConfigKeys } from './config.js';
import { implement } from './implement.js';
import { bindPorts, portsKernel, undurableOperations } from './kernel.js';
import { collectImplementations } from './topology.js';
import { BusTransport$ } from './transport.js';

import type { BuiltContainer } from '@nestlingjs/container';
import {
  ContainerBuilder,
  factoryProvider,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';
import type { Emitter, Port } from '@nestlingjs/operations';
import {
  EmitterFamily,
  makeEvent,
  makeFail,
  makeRequest,
  PortFamily,
} from '@nestlingjs/operations';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const NotReady = makeFail('conflict:not_ready', { message: 'not ready' });

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
  handler: async (input) => {
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
  handler: async () => undefined,
});

const PassthroughImpl = implement(Passthrough, {
  handler: async (payload) => {
    receivedPayload = payload;

    return new Ok({ ok: true });
  },
});

let placedSeen: string[] = [];

const PlacedImpl = implement(Placed, {
  subscriber: 'audit',
  handler: async (input) => {
    placedSeen.push(input.id);

    return undefined;
  },
});

/** Операция, чья реализация всегда отказывает: на ней виден исход `failed` */
const Failing = makeRequest({
  name: 'kernel.failing',
  output: z.object({ ok: z.boolean() }),
  errors: [NotReady],
});

const FailingImpl = implement(Failing, {
  handler: async () => NotReady(),
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

interface Built {
  container: BuiltContainer;
  metrics: MetricsProbe;
  bus?: InProcessBus;
  close: () => Promise<void>;
}

/**
 * Мини-корень: те же шаги, что делает `App` в фазах BUILD и WIRE, но без
 * импорта каталога `root` (стрелка зависимостей идёт оттуда сюда).
 */
async function build(options: {
  declarations?: readonly AnyEndpointDefinition[];
  consumers?: readonly Parameters<ContainerBuilder['register']>[0][];
  dispatch?: 'local-first' | 'always-remote';
  wire?: boolean;
  /** Корень поставил remote-шину — то же, что `nats()` в `transports:` */
  rootBus?: FakeRemoteBus;
}): Promise<Built> {
  const declarations = options.declarations ?? [];
  const source = objectSource(
    options.dispatch === undefined
      ? {}
      : { NESTLING_PORTS_DISPATCH: options.dispatch },
  );

  // Записи логгера здесь не наблюдаются: отказы вызывателей и доставки
  // проверяются отдельными тестами, а тест смотрит на биндинг. Корневой
  // логгер и store метрик живут вне графа, поэтому регистрируются
  // значениями — так же, как это делает сборка приложения
  const metrics = probeMetrics();
  const builder = new ContainerBuilder();
  builder.register(
    configKernel(
      await bootstrapConfig([bind(source, { keys: portsConfigKeys })]),
    ),
  );
  builder.register(
    contextKernel(),
    loggerKernel(),
    valueProvider(RootLogger$, spyLogger().logger),
    valueProvider(MetricsStore$, metrics.store),
    metricsKernel([KernelMetrics]),
  );
  builder.register(
    portsKernel({
      implementations: collectImplementations(
        declarations.map((endpoint) => ({
          endpoint,
          moduleName: 'module:test',
        })),
      ),
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

  const container = builder.build();

  // Экземпляры создаёт INIT: до него граф собран, но пуст
  await container.init();

  const bus = container.get(MessageBus$) as InProcessBus | null;

  if (options.wire === false) {
    return {
      container,
      metrics,
      ...(bus === null ? {} : { bus }),
      close: async () => bus?.close(),
    };
  }

  const dispatch = makeDispatch(
    declarations.map((declaration) =>
      declaration.resolve((token) => container.get(token) ?? undefined),
    ),
    { metrics: metrics.kernel },
  );

  const dispatches = new Map<TransportRef, Dispatch>([
    [BusTransport$ as TransportRef, dispatch],
  ]);

  // `bindPorts` — тот же шаг, что делает `App` на WIRE: он и наполняет
  // держатель, и подписывает шину на её маршруты
  bindPorts(container, dispatches);

  return {
    container,
    metrics,
    ...(bus === null ? {} : { bus }),
    close: async () => bus?.close(),
  };
}

/** Записи счётчика вызовов порта */
const { requests } = KernelMetrics.members;
const portCalls = KernelMetrics.members['port.calls'];
const portDuration = KernelMetrics.members['port.duration'];

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

const failingConsumer = factoryProvider(
  Consumer,
  (port: Port<any>) => ({ port }),
  [Failing.caller],
);

describe('portsKernel', () => {
  beforeEach(() => {
    placedSeen = [];
  });

  it('создаёт вызыватель только для запрошенных операций', async () => {
    const app = await build({
      declarations: [EchoImpl],
      consumers: [portConsumer],
    });

    expect(app.container.get(PortFamily(Echo.name))).not.toBeNull();
    expect(app.container.get(PortFamily(Unused.name))).toBeNull();

    await app.close();
  });

  it('приложение без операций не заводит ни одного узла портов', async () => {
    const app = await build({});

    expect(app.container.get(MessageBus$)).toBeNull();
    expect(app.container.get(BusTransport$)).toBeNull();
    expect(app.container.get(PortFamily(Echo.name))).toBeNull();

    await app.close();
  });

  it('local-first зовёт реализацию без копирования payload', async () => {
    const app = await build({
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
    const app = await build({
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
      build({
        declarations: [EchoImpl],
        consumers: [portConsumer],
        dispatch: 'balanced' as never,
      }),
      // Перечень значений приходит от валидатора
    ).rejects.toThrow(/"local-first"\|"always-remote"/);
  });

  it('недостижимая операция — ошибка сборки', async () => {
    const orphanConsumer = factoryProvider(
      Consumer,
      (port: Port<any>) => ({ port }),
      [Orphan.caller],
    );

    await expect(
      build({ declarations: [EchoImpl], consumers: [orphanConsumer] }),
    ).rejects.toThrow(/'kernel\.orphan'.*no selected feature implements it/s);
  });

  it('эмиттер события без подписчиков не роняет вызов и доставляет ноль раз', async () => {
    const eventConsumer = factoryProvider(
      EventConsumer,
      (emitter: Emitter<any>) => ({ emitter }),
      [Placed.emitter],
    );

    const app = await build({
      declarations: [EchoImpl],
      consumers: [eventConsumer],
    });

    const { emitter } = app.container.getOrThrow(EventConsumer);

    await expect(emitter.emit({ id: 'o-1' })).resolves.toBeUndefined();
    expect(app.container.get(EmitterFamily(Placed.name))).not.toBeNull();

    await app.close();
  });

  it('называет операции, обслуживаемые недолговечно', async () => {
    const app = await build({ declarations: [DurableImpl, EchoImpl] });

    expect(undurableOperations(app.container, [DurableImpl, EchoImpl])).toEqual(
      ['kernel.durable.placed'],
    );

    await app.close();
  });

  it('без долговечных операций список пуст', async () => {
    const app = await build({ declarations: [EchoImpl] });

    expect(undurableOperations(app.container, [EchoImpl])).toEqual([]);

    await app.close();
  });

  it('шина, умеющая долговечность, деградации не даёт', async () => {
    const app = await build({ declarations: [DurableImpl] });

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

    // Владельца нет нигде в кластере: тест смотрит на биндинг, не на записи
    const rootBus = new FakeRemoteBus({ logger: spyLogger().logger });

    const app = await build({ consumers: [orphanConsumer], rootBus });

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
    const app = await build({ consumers: [orphanConsumer], rootBus });

    expect(app.container.get(PortFamily(Orphan.name))).not.toBeNull();

    await app.close();
  });

  it('шину поставил корень: оба DI-токена дают его инстанс', async () => {
    const rootBus = new FakeRemoteBus();
    const app = await build({ declarations: [EchoImpl], rootBus });

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
    const app = await build({
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

    const app = await build({
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
    const app = await build({
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
    const app = await build({
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

describe('portsKernel — метрики вызова', () => {
  it.each([
    ['local-first', 'local'],
    ['always-remote', 'remote'],
  ] as const)(
    'политика %s даёт тот же набор метрик, различая биндинг',
    async (dispatch, binding) => {
      const app = await build({
        declarations: [EchoImpl],
        consumers: [portConsumer],
        dispatch,
      });

      const { port } = app.container.getOrThrow(Consumer);
      await port.call({ items: [1] });

      const attributes = {
        operation: 'kernel.echo',
        kind: 'request',
        binding,
        outcome: 'completed',
      };

      expect(app.metrics.of(portCalls, attributes)).toMatchObject({
        kind: 'counter',
        value: 1,
      });
      expect(app.metrics.of(portDuration, attributes)).toMatchObject({
        kind: 'histogram',
        count: 1,
      });

      await app.close();
    },
  );

  it('emit события учитывается', async () => {
    const eventConsumer = factoryProvider(
      EventConsumer,
      (emitter: Emitter<any>) => ({ emitter }),
      [Placed.emitter],
    );

    const app = await build({
      declarations: [PlacedImpl],
      consumers: [eventConsumer],
    });

    const { emitter } = app.container.getOrThrow(EventConsumer);
    await emitter.emit({ id: 'o-1' });

    expect(
      app.metrics.of(portCalls, {
        operation: 'kernel.placed',
        kind: 'event',
        outcome: 'completed',
      }),
    ).toMatchObject({ value: 1 });

    await app.close();
  });

  it('объявленный отказ реализации даёт outcome failed', async () => {
    const app = await build({
      declarations: [FailingImpl],
      consumers: [failingConsumer],
    });

    const { port } = app.container.getOrThrow(Consumer);
    await port.call();

    expect(
      app.metrics.of(portCalls, {
        operation: 'kernel.failing',
        outcome: 'failed',
      }),
    ).toMatchObject({ value: 1 });

    await app.close();
  });

  it('локальный вызов даёт и метрику порта, и метрику endpoint’а', async () => {
    const app = await build({
      declarations: [EchoImpl],
      consumers: [portConsumer],
      dispatch: 'local-first',
    });

    const { port } = app.container.getOrThrow(Consumer);
    await port.call({ items: [1] });

    expect(app.metrics.all(portCalls, { binding: 'local' })).toHaveLength(1);
    expect(app.metrics.all(requests)).toHaveLength(1);

    await app.close();
  });

  it('обёртка вызывателя ставится без единой настройки', async () => {
    const app = await build({
      declarations: [EchoImpl],
      consumers: [portConsumer],
    });

    const { port } = app.container.getOrThrow(Consumer);
    await port.call({ items: [1] });

    expect(app.metrics.all(portCalls)).not.toEqual([]);

    await app.close();
  });
});
