/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * Порты под `assemble`: две фичи, общающиеся операцией, шаг связывания в
 * WIRE и обе политики диспатча — переключаемые конфигом, а не кодом.
 */

import { objectSource } from '../config/index.js';
import type { AnyInput, ExtendableContext } from '../pipeline/index.js';
import { makeEmptyContext, Ok } from '../pipeline/index.js';
import type { Port } from '../ports/index.js';
import {
  BusTransport$,
  implement,
  InProcessBus,
  portsConfigKeys,
} from '../ports/index.js';
import type { ITransport } from '../transport/index.js';
import { transportValue } from '../transport/index.js';

import { entriesWith, loggerProbe } from './__fixtures__/logger.js';
import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import { Handler, makeToken, OnStart, Resource } from '@nestlingjs/container';
import { makeEvent, makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

const asTransport = (transport: ITransport) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: ALL_FORMS,
  });

const contextFor = (pattern: string, payload?: unknown) =>
  makeEmptyContext(
    { transport: 'test', pattern, payload, attributes: {} },
    { transport: 'test', pattern },
  ) as ExtendableContext<AnyInput>;

const ChargeCard = makeRequest({
  name: 'app.billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const OrderPlaced = makeEvent({
  name: 'app.orders.placed',
  input: z.object({ orderId: z.string() }),
});

let charged: number[] = [];
let notified: string[] = [];

/** Фича-владелец: реализует операции как обычные декларации */
const BillingFeature = makeFeature({
  name: 'billing',
  endpoints: [
    implement(ChargeCard, {
      handler: async (input) => {
        charged.push(input.amount);

        return new Ok({ chargeId: `c-${input.amount}` });
      },
    }),
    implement(OrderPlaced, {
      subscriber: 'billing',
      handler: async (input) => {
        notified.push(input.orderId);

        return undefined;
      },
    }),
  ],
});

@Handler([ChargeCard.caller])
class PlaceOrderHandler {
  constructor(private readonly billing: Port<typeof ChargeCard>) {}

  async handle(input: { amount: number }) {
    const charge = await this.billing.call({ amount: input.amount });

    if (charge.isFail) {
      return charge as never;
    }

    return new Ok({ chargeId: charge.value.chargeId });
  }
}

/** Фича-потребитель: инжектит вызыватели и зовёт их из HTTP-endpoint'а */
const OrdersFeature = makeFeature({
  name: 'orders',
  endpoints: [
    testEndpoint({
      method: 'POST',
      path: '/orders',
      input: z.object({ amount: z.number() }),
      output: z.object({ chargeId: z.string() }),
      handler: PlaceOrderHandler,
    }),
  ],
});

/** Потребитель без владельца рядом: операция объявлена, реализации нет */
const LonelyOperation = makeRequest({
  name: 'app.lonely.request',
  output: z.object({ ok: z.boolean() }),
});

const LonelyToken = makeToken<{ port: Port<typeof LonelyOperation> }>('Lonely');

const LonelyFeature = makeFeature({
  name: 'lonely',
  providers: [
    {
      provide: LonelyToken,
      useFactory: (port: Port<typeof LonelyOperation>) => ({ port }),
      deps: [LonelyOperation.caller],
    },
  ],
});

/** Долговечное событие: на in-proc шине оно обслуживается недолговечно */
const DurablePlaced = makeEvent({
  name: 'app.durable.placed',
  durable: true,
  input: z.object({ orderId: z.string() }),
});

const DurableFeature = makeFeature({
  name: 'durable',
  endpoints: [
    implement(DurablePlaced, {
      subscriber: 'archive',
      handler: async () => undefined,
    }),
  ],
});

/**
 * Шина, объявившая себя remote, — то, чем в бою будет `nats()`.
 *
 * Тест не о брокере, а о композиции: корень поставил транспорт шины, и
 * приложение обязано собраться даже без единой реализации операции.
 */
class RemoteBus extends InProcessBus {
  override readonly remote: boolean = true;
}

const portsConfig = (dispatch?: 'local-first' | 'always-remote') =>
  [
    [
      objectSource(
        dispatch === undefined ? {} : { NESTLING_PORTS_DISPATCH: dispatch },
      ),
      portsConfigKeys,
    ],
  ] as const;

describe('assemble — порты', () => {
  beforeEach(() => {
    charged = [];
    notified = [];
  });

  it.each<['local-first' | 'always-remote']>([
    ['local-first'],
    ['always-remote'],
  ])('две фичи общаются операцией при политике %s', async (dispatch) => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [OrdersFeature, BillingFeature],
      transports: [asTransport(transport)],
      config: portsConfig(dispatch),
    }).assemble();

    await app.run();

    const response = await transport.dispatch?.call(
      'POST /orders',
      contextFor('POST /orders', { amount: 42 }),
    );

    expect(response).toMatchObject({
      isSuccess: true,
      value: { chargeId: 'c-42' },
    });
    expect(charged).toEqual([42]);

    await app.close();
  });

  it('транспорт шины начинает принимать запросы вместе с реализациями', async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [OrdersFeature, BillingFeature],
      transports: [asTransport(transport)],
      config: portsConfig(),
    });

    const report = await app.check();

    expect(report.transports).toEqual(['test', 'bus']);
    expect(report.endpoints.map((endpoint) => endpoint.pattern)).toEqual(
      expect.arrayContaining([
        'app.billing.charge',
        'app.orders.placed@billing',
      ]),
    );
  });

  it('приложение без операций не упоминает шину ни в чём', async () => {
    const transport = new MockTransport();
    const app = makeApp({
      features: [
        makeFeature({
          name: 'module:plain',
          endpoints: [
            testEndpoint({
              method: 'GET',
              path: '/ping',
              handler: async () => new Ok({ pong: true }),
            }),
          ],
        }),
      ],
      transports: [asTransport(transport)],
    });

    const report = await app.check();

    expect(report.transports).toEqual(['test']);

    const assembled = app.assemble();
    await assembled.run();
    await assembled.close();
  });

  it('`select` без фичи-владельца роняет сборку на WIRE', async () => {
    // Достижимость вызывателя — забота WIRE, а не структурной проверки:
    // `check()` не доходит до связывания портов, поэтому падает `run()`
    const app = makeApp({
      features: [LonelyFeature],
      transports: [asTransport(new MockTransport())],
      config: portsConfig(),
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /'app\.lonely\.request'.*no selected feature implements it/s,
    );
  });

  it('порт связан к моменту `@OnStart` и не связан при захвате ресурса (INIT)', async () => {
    const seen: string[] = [];

    @Resource([ChargeCard.caller])
    class Warmup {
      static async acquire(
        billing: Port<typeof ChargeCard>,
        _signal: AbortSignal,
      ): Promise<Warmup> {
        // Фаза INIT: WIRE ещё впереди, связывать вызыватель не с чем
        await billing
          .call({ amount: 1 })
          .catch((error: Error) => void seen.push(`init: ${error.message}`));

        return new Warmup(billing);
      }

      constructor(private readonly billing: Port<typeof ChargeCard>) {}

      // Тест про связывание порта, а не про освобождение: отпускать нечего
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      release(): void {}

      @OnStart()
      async onStart(): Promise<void> {
        // Фаза 4: WIRE позади, вызов исполняется
        const charge = await this.billing.call({ amount: 7 });
        seen.push(
          charge.isFail ? 'start: fail' : `start: ${charge.value.chargeId}`,
        );
      }
    }

    const WarmupFeature = makeFeature({
      name: 'warmup',
      providers: [Warmup],
    });

    const app = makeApp({
      features: [WarmupFeature, BillingFeature],
      transports: [asTransport(new MockTransport())],
      config: portsConfig(),
    }).assemble();

    await app.run();

    expect(seen[0]).toMatch(/init: .*before phase 3 WIRE/);
    expect(seen[1]).toBe('start: c-7');

    await app.close();
  });

  it('эмиттер доставляет событие подписчику соседней фичи', async () => {
    const Notifier = makeToken<{ emit: (orderId: string) => Promise<void> }>(
      'Notifier',
    );

    @Handler([Notifier])
    class NotifyHandler {
      constructor(
        private readonly notifier: { emit: (orderId: string) => Promise<void> },
      ) {}

      async handle(input: { orderId: string }) {
        await this.notifier.emit(input.orderId);

        return new Ok({ accepted: true });
      }
    }

    const NotifierFeature = makeFeature({
      name: 'notifier',
      providers: [
        {
          provide: Notifier,
          useFactory: (emitter: {
            emit: (payload: { orderId: string }) => Promise<void>;
          }) => ({
            emit: (orderId: string) => emitter.emit({ orderId }),
          }),
          deps: [OrderPlaced.emitter],
        },
      ],
      endpoints: [
        testEndpoint({
          method: 'POST',
          path: '/notify',
          input: z.object({ orderId: z.string() }),
          handler: NotifyHandler,
        }),
      ],
    });

    const transport = new MockTransport();
    const app = makeApp({
      features: [NotifierFeature, BillingFeature],
      transports: [asTransport(transport)],
      config: portsConfig(),
    }).assemble();

    await app.run();

    await transport.dispatch?.call(
      'POST /notify',
      contextFor('POST /notify', { orderId: 'o-1' }),
    );

    // Доставка асинхронна по операции `emit`: он резолвится по факту
    // постановки вызова, а не по факту обработки
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notified).toEqual(['o-1']);

    await app.close();
  });

  it('деградация долговечности — запись warn только при старте приёма запросов', async () => {
    const degradedProbe = loggerProbe();
    const degraded = makeApp({
      features: [DurableFeature],
      transports: [asTransport(new MockTransport())],
      config: portsConfig(),
      logger: degradedProbe.logger,
    }).assemble();

    await degraded.run();
    await degraded.close();

    const message = 'durable delivery is not available on this bus';
    const records = entriesWith(degradedProbe, message);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'warn',
      fields: { scope: 'nestling', operations: ['app.durable.placed'] },
    });

    // То же приложение без долговечных операций молчит
    const plainProbe = loggerProbe();
    const plain = makeApp({
      features: [BillingFeature],
      transports: [asTransport(new MockTransport())],
      config: portsConfig(),
      logger: plainProbe.logger,
    }).assemble();

    await plain.run();
    await plain.close();

    expect(entriesWith(plainProbe, message)).toEqual([]);
  });

  it('корень поставил шину: приложение обслуживается ею, а не in-proc', async () => {
    const bus = new RemoteBus();
    const app = makeApp({
      features: [BillingFeature],
      transports: [
        asTransport(new MockTransport()),
        transportValue(BusTransport$, bus, {
          name: 'events',
          bus: true,
          capabilities: VALUE_ONLY,
        }),
      ],
      intercom: 'events',
      config: portsConfig(),
    }).assemble();

    await app.run();

    // Маршруты реализаций подписаны на шину, поставленную корнем: своей
    // in-proc шины kernel-модуль не завёл, иначе публикация ушла бы в пустоту
    await bus.publish('app.orders.placed', { orderId: 'o-9' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notified).toEqual(['o-9']);

    await app.close();
  });

  it('чистый потребитель собирается при корневой remote-шине', async () => {
    const bus = new RemoteBus();
    const app = makeApp({
      features: [LonelyFeature],
      transports: [
        asTransport(new MockTransport()),
        transportValue(BusTransport$, bus, {
          name: 'events',
          bus: true,
          capabilities: VALUE_ONLY,
        }),
      ],
      intercom: 'events',
      config: portsConfig(),
    }).assemble();

    // Ни одной реализации операции в сборке нет, а вызыватель есть:
    // владелец живёт в другом процессе, и это больше не ошибка сборки
    await expect(app.run()).resolves.toBeUndefined();

    await app.close();
  });

  it('без remote-шины тот же потребитель по-прежнему валит сборку', async () => {
    const app = makeApp({
      features: [LonelyFeature],
      transports: [asTransport(new MockTransport())],
      config: portsConfig(),
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /'app\.lonely\.request'.*no selected feature implements it/s,
    );
  });
});
