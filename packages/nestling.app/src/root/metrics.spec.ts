/**
 * Метрики приложения: каталог сборки, store узлом графа и вклад
 * `metrics:`.
 *
 * Проверяется сборка целиком: группа подключается вкладом, писателя
 * раздаёт граф, а накопленное лежит в store — без единой опции корня.
 */

import type { MetricsOf } from '../metrics/index.js';
import {
  counter,
  findSeries,
  findSeriesOne,
  histogram,
  KernelMetrics,
  makeMetrics,
  MetricsStore$,
  open,
} from '../metrics/index.js';
import { Ok } from '../pipeline/index.js';
import type { Port } from '../ports/index.js';
import { implement } from '../ports/index.js';
import { wireApp } from '../testing/index.js';
import { transportValue } from '../transport/index.js';

import {
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import {
  Component,
  factoryProvider,
  makeSwitch,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';
import { makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

const ChargeCard = makeRequest({
  name: 'billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const Caller$ = makeToken<{ port: Port<typeof ChargeCard> }>('Caller');

const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'] },
  }),

  'checkout.duration': histogram({ unit: 'ms', buckets: [10, 100] }),

  received: counter({ attributes: { queue: open } }),
});

const QuotasMetrics = makeMetrics('quotas', { claims: counter() });

const asTransport = (transport: MockTransport) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: VALUE_ONLY,
  });

const ping = () =>
  testEndpoint({
    method: 'GET',
    path: '/ping',
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

/** Сервис, который пишет свою метрику при создании экземпляра */
@Component([OrdersMetrics])
class OrdersService {
  constructor(metrics: MetricsOf<typeof OrdersMetrics>) {
    metrics.created.add(2, { tier: 'paid' });
    metrics.received.add({ queue: 'mail' });
  }
}

describe('метрики приложения — вклад и каталог', () => {
  it('группа фичи попадает в каталог, а писателя даёт граф', async () => {
    const Orders = makeFeature({
      name: 'orders',
      metrics: [OrdersMetrics],
      providers: [OrdersService],
      endpoints: [ping()],
    });

    const app = makeApp({
      features: [Orders],
      transports: [asTransport(new MockTransport())],
    });

    const wired = await wireApp(app);
    const snapshot = wired.container.getOrThrow(MetricsStore$).snapshot();

    expect(
      findSeriesOne(snapshot, OrdersMetrics.members.created, { tier: 'paid' }),
    ).toMatchObject({ value: 2 });

    expect(
      findSeriesOne(snapshot, OrdersMetrics.members.received, {
        queue: 'mail',
      }),
    ).toMatchObject({ value: 1 });

    await wired.close();
  });

  it('группа корня подключается полем makeApp', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      metrics: [QuotasMetrics],
    });

    const wired = await wireApp(app);

    expect(
      wired.container.getOrThrow(MetricsStore$).catalog.metric('quotas.claims'),
    ).toMatchObject({ kind: 'counter' });

    await wired.close();
  });

  it('группа невыбранной фичи в каталог не попадает', async () => {
    const Orders = makeFeature({
      name: 'orders',
      metrics: [OrdersMetrics],
      endpoints: [ping()],
    });
    const Quotas = makeFeature({
      name: 'quotas',
      metrics: [QuotasMetrics],
      endpoints: [],
    });

    const app = makeApp({
      features: [Orders, Quotas],
      transports: [asTransport(new MockTransport())],
    });

    const wired = await wireApp(app, { args: { features: ['orders'] } });
    const { catalog } = wired.container.getOrThrow(MetricsStore$);

    expect(catalog.metric('orders.created')).toBeDefined();
    expect(catalog.metric('quotas.claims')).toBeUndefined();

    await wired.close();
  });

  it('ветка переключателя меняет каталог', async () => {
    const Tier = makeSwitch('tier', ['free', 'paid']);

    const Orders = makeFeature({
      name: 'orders',
      metrics: [Tier.pick({ free: [], paid: [QuotasMetrics] })],
      endpoints: [ping()],
    });

    const app = makeApp({
      features: [Orders],
      switches: [Tier],
      transports: [asTransport(new MockTransport())],
    });

    const wired = await wireApp(app, { args: { tier: 'free' } });

    expect(
      wired.container.getOrThrow(MetricsStore$).catalog.metric('quotas.claims'),
    ).toBeUndefined();

    await wired.close();
  });

  it('группа запрошена, но не подключена — отказ сборки', async () => {
    const Orders = makeFeature({
      name: 'orders',
      providers: [OrdersService],
      endpoints: [ping()],
    });

    const app = makeApp({
      features: [Orders],
      transports: [asTransport(new MockTransport())],
    });

    await expect(wireApp(app)).rejects.toThrow(
      /Metrics:orders.*declare the group in 'metrics:'/s,
    );
  });
});

describe('метрики приложения — store в графе', () => {
  it('store есть без единой настройки, и метрики ядра в нём', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
    });

    const wired = await wireApp(app);
    const snapshot = wired.container.getOrThrow(MetricsStore$).snapshot();

    expect(findSeries(snapshot, KernelMetrics.members.requests)).toHaveLength(
      4,
    );

    await wired.close();
  });

  it('ряды вызова порта есть до первого вызова', async () => {
    const Billing = makeFeature({
      name: 'billing',
      endpoints: [
        implement(ChargeCard, {
          handler: async () => new Ok({ chargeId: 'c-1' }),
        }),
      ],
      providers: [
        factoryProvider(
          Caller$,
          (port: Port<typeof ChargeCard>) => ({ port }),
          [ChargeCard.caller],
        ),
      ],
    });

    const app = makeApp({
      features: [Billing],
      transports: [asTransport(new MockTransport())],
    });

    const wired = await wireApp(app);
    const snapshot = wired.container.getOrThrow(MetricsStore$).snapshot();

    expect(
      findSeries(snapshot, KernelMetrics.members['port.calls'], {
        operation: 'billing.charge',
      }),
    ).toHaveLength(4);
    expect(
      findSeries(snapshot, KernelMetrics.members['port.calls']).every(
        (series) => series.kind === 'counter' && series.value === 0,
      ),
    ).toBe(true);

    await wired.close();
  });

  it('провайдер под MetricsStore$ отвергается, называя владельца узла', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [valueProvider(MetricsStore$, null as never)],
    });

    await expect(wireApp(app)).rejects.toThrow(/store belongs to the kernel/);
  });
});
