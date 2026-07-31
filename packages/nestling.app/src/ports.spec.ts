/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`). */
/**
 * Порты под `assemble`: две фичи, общающиеся контрактом, шаг связывания в
 * WIRE и обе политики диспатча — переключаемые конфигом, а не кодом.
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';
import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import { objectSource } from '@nestling/config';
import {
  Injectable,
  makeToken,
  OnInit,
  OnStart,
  valueProvider,
} from '@nestling/container';
import type { AnyInput, ExtendableContext } from '@nestling/pipeline';
import { makeEmptyContext, Ok } from '@nestling/pipeline';
import type { Port } from '@nestling/ports';
import { implement, makeContract, portsConfigKeys } from '@nestling/ports';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

const contextFor = (pattern: string, payload?: unknown) =>
  makeEmptyContext(
    { transport: 'http', pattern, payload, attributes: {} },
    { transport: 'http', pattern },
  ) as ExtendableContext<AnyInput>;

const ChargeCard = makeContract({
  name: 'app.billing.charge',
  kind: 'request',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const OrderPlaced = makeContract({
  name: 'app.orders.placed',
  kind: 'event',
  input: z.object({ orderId: z.string() }),
});

let charged: number[] = [];
let notified: string[] = [];

/** Фича-владелец: реализует контракты как обычные декларации */
const BillingFeature = makeFeature({
  name: 'billing',
  modules: [
    makeAppModule({
      name: 'module:billing',
      endpoints: [
        implement(ChargeCard, {
          handle: async (input) => {
            charged.push(input.amount);

            return new Ok({ chargeId: `c-${input.amount}` });
          },
        }),
        implement(OrderPlaced, {
          subscriber: 'billing',
          handle: async (input) => {
            notified.push(input.orderId);

            return undefined;
          },
        }),
      ],
    }),
  ],
});

/** Фича-потребитель: инжектит вызыватели и зовёт их из HTTP-ручки */
const OrdersFeature = makeFeature({
  name: 'orders',
  modules: [
    makeAppModule({
      name: 'module:orders',
      endpoints: [
        httpEndpoint({
          method: 'POST',
          path: '/orders',
          input: z.object({ amount: z.number() }),
          output: z.object({ chargeId: z.string() }),
          deps: [ChargeCard.port],
          handle:
            (billing: Port<typeof ChargeCard>) =>
            async (input: { amount: number }) => {
              const charge = await billing.call({ amount: input.amount });

              if (charge.isFail) {
                return charge as never;
              }

              return new Ok({ chargeId: charge.value.chargeId });
            },
        }),
      ],
    }),
  ],
});

/** Потребитель без владельца рядом: контракт объявлен, реализации нет */
const LonelyContract = makeContract({
  name: 'app.lonely.request',
  kind: 'request',
  output: z.object({ ok: z.boolean() }),
});

const LonelyToken = makeToken<{ port: Port<typeof LonelyContract> }>('Lonely');

const LonelyFeature = makeFeature({
  name: 'lonely',
  modules: [
    makeAppModule({
      name: 'module:lonely',
      providers: [
        {
          provide: LonelyToken,
          useFactory: (port: Port<typeof LonelyContract>) => ({ port }),
          deps: [LonelyContract.port],
        },
      ],
    }),
  ],
});

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
  ])('две фичи общаются контрактом при политике %s', async (dispatch) => {
    const http = new MockTransport();
    const app = assemble({
      features: [OrdersFeature, BillingFeature],
      transports: [asHttpTransport(http)],
      config: portsConfig(dispatch),
    });

    await app.run();

    const response = await http.dispatch?.call(
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

  it('транспорт шины выходит в эфир вместе с реализациями', async () => {
    const http = new MockTransport();
    const app = assemble({
      features: [OrdersFeature, BillingFeature],
      transports: [asHttpTransport(http)],
      config: portsConfig(),
    });

    const report = await app.check();

    expect(report.transports).toEqual(['http', 'bus']);
    expect(report.endpoints.map((endpoint) => endpoint.pattern)).toEqual(
      expect.arrayContaining([
        'app.billing.charge',
        'app.orders.placed@billing',
      ]),
    );

    await app.close();
  });

  it('приложение без контрактов не упоминает шину ни в чём', async () => {
    const http = new MockTransport();
    const app = assemble({
      modules: [
        makeAppModule({
          name: 'module:plain',
          endpoints: [
            httpEndpoint({
              method: 'GET',
              path: '/ping',
              handle: async () => new Ok({ pong: true }),
            }),
          ],
        }),
      ],
      transports: [asHttpTransport(http)],
    });

    const report = await app.check();

    expect(report.transports).toEqual(['http']);

    await app.run();
    await app.close();
  });

  it('`select` без фичи-владельца роняет сборку на ASSEMBLE', async () => {
    const app = assemble({
      features: [LonelyFeature],
      transports: [asHttpTransport(new MockTransport())],
      config: portsConfig(),
    });

    await expect(app.check()).rejects.toThrow(
      /'app\.lonely\.request'.*no selected module implements it/s,
    );
  });

  it('порт связан к моменту `@OnStart` и не связан в `@OnInit`', async () => {
    const seen: string[] = [];

    @Injectable([ChargeCard.port])
    class Warmup {
      constructor(private readonly billing: Port<typeof ChargeCard>) {}

      @OnInit()
      async onInit(): Promise<void> {
        // Фаза 2: `dispatch` ещё не рождён, связывать вызыватель не с чем
        await this.billing
          .call({ amount: 1 })
          .catch((error: Error) => void seen.push(`init: ${error.message}`));
      }

      @OnStart()
      async onStart(): Promise<void> {
        // Фаза 4: WIRE позади, вызов исполняется
        const charge = await this.billing.call({ amount: 7 });
        seen.push(charge.isFail ? 'start: fail' : `start: ${charge.value.chargeId}`);
      }
    }

    const WarmupFeature = makeFeature({
      name: 'warmup',
      modules: [makeAppModule({ name: 'module:warmup', providers: [Warmup] })],
    });

    const app = assemble({
      features: [WarmupFeature, BillingFeature],
      transports: [asHttpTransport(new MockTransport())],
      config: portsConfig(),
    });

    await app.run();

    expect(seen[0]).toMatch(/init: .*before phase 3 WIRE/);
    expect(seen[1]).toBe('start: c-7');

    await app.close();
  });

  it('эмиттер доставляет событие подписчику соседней фичи', async () => {
    const Notifier = makeToken<{ emit: (orderId: string) => Promise<void> }>(
      'Notifier',
    );

    const NotifierFeature = makeFeature({
      name: 'notifier',
      modules: [
        makeAppModule({
          name: 'module:notifier',
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
            httpEndpoint({
              method: 'POST',
              path: '/notify',
              input: z.object({ orderId: z.string() }),
              deps: [Notifier],
              handle:
                (notifier: { emit: (orderId: string) => Promise<void> }) =>
                async (input: { orderId: string }) => {
                  await notifier.emit(input.orderId);

                  return new Ok({ accepted: true });
                },
            }),
          ],
        }),
      ],
    });

    const http = new MockTransport();
    const app = assemble({
      features: [NotifierFeature, BillingFeature],
      transports: [asHttpTransport(http)],
      config: portsConfig(),
    });

    await app.run();

    await http.dispatch?.call(
      'POST /notify',
      contextFor('POST /notify', { orderId: 'o-1' }),
    );

    // Доставка асинхронна по контракту `emit`: он резолвится по факту
    // постановки вызова, а не по факту обработки
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notified).toEqual(['o-1']);

    await app.close();
  });
});
