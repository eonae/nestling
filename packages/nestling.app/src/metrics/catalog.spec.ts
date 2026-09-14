/**
 * Каталог: состав вкладов, адреса рядов и отказ на совпадение имён.
 */

import type { CatalogMetric, MetricsCatalog } from './catalog.js';
import { makeCatalog, seriesIndex, seriesKey } from './catalog.js';
import { counter, histogram, makeMetrics, open } from './declaration.js';
import { KernelMetrics, kernelSeries } from './kernel-group.js';

import { describe, expect, it } from '@jest/globals';

const Orders = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'], region: ['eu', 'us'] },
  }),

  'checkout.duration': histogram({
    unit: 'ms',
    buckets: [10, 100],
    attributes: { step: ['validate', 'charge'] },
  }),
});

const Queues = makeMetrics('queues', {
  received: counter({ attributes: { queue: open } }),
});

const contributionsOf = (...groups: readonly (typeof Orders)[]) =>
  groups.map((group) => ({ group, owner: "feature 'orders'" }));

/** Метрика каталога или понятный отказ: спека адресует существующее */
const metricOf = (catalog: MetricsCatalog, name: string): CatalogMetric => {
  const metric = catalog.metric(name);

  if (!metric) {
    throw new Error(`Metric '${name}' is not in the catalog`);
  }

  return metric;
};

describe('каталог — состав', () => {
  it('метрика несёт полное имя и каталожные поля', () => {
    const catalog = makeCatalog(contributionsOf(Orders));

    expect(catalog.metric('orders.created')).toMatchObject({
      name: 'orders.created',
      kind: 'counter',
      help: 'Created orders',
      attributes: ['tier', 'region'],
    });

    expect(catalog.metric('orders.checkout.duration')).toMatchObject({
      kind: 'histogram',
      unit: 'ms',
      buckets: [10, 100],
    });
  });

  it('ряды объявленных атрибутов — произведение перечней', () => {
    const catalog = makeCatalog(contributionsOf(Orders));
    const created = catalog.metric('orders.created');

    expect(created?.width).toBe(4);
    expect(created?.series).toEqual([
      { tier: 'free', region: 'eu' },
      { tier: 'free', region: 'us' },
      { tier: 'paid', region: 'eu' },
      { tier: 'paid', region: 'us' },
    ]);
  });

  it('индексы рядов сплошные и раздельные по видам', () => {
    const catalog = makeCatalog(contributionsOf(Orders));

    expect(catalog.counters).toBe(4);
    expect(catalog.histograms).toBe(2);
    expect(catalog.metric('orders.created')?.base).toBe(0);
    expect(catalog.metric('orders.checkout.duration')?.base).toBe(0);
  });

  it('одна группа, подключённая дважды, даёт один вклад', () => {
    const catalog = makeCatalog([
      { group: Orders, owner: "feature 'orders'" },
      { group: Orders, owner: "feature 'billing'" },
    ]);

    expect(
      catalog.metrics.filter(({ name }) => name === 'orders.created'),
    ).toHaveLength(1);
  });

  it('метрика с открытым атрибутом рядов заранее не имеет', () => {
    const catalog = makeCatalog([{ group: Queues, owner: "feature 'queues'" }]);

    expect(catalog.metric('queues.received')?.width).toBe(0);
    expect(catalog.counters).toBe(0);
  });

  it('невыбранная группа метрик не даёт', () => {
    const catalog = makeCatalog(contributionsOf(Orders));

    expect(catalog.metric('queues.received')).toBeUndefined();
    expect(catalog.members(Queues).size).toBe(0);
  });
});

describe('каталог — совпадение имён', () => {
  it('две группы с одним полным именем роняют сборку', () => {
    const first = makeMetrics('orders', { created: counter() });
    const second = makeMetrics('orders', { created: counter() });

    expect(() =>
      makeCatalog([
        { group: first, owner: "feature 'orders'" },
        { group: second, owner: "plugin '@acme/orders'" },
      ]),
    ).toThrow(
      /Two metric groups declare 'orders.created'.*feature 'orders'.*plugin '@acme\/orders'/s,
    );
  });
});

describe('каталог — адресация ряда', () => {
  it('индекс ряда вычисляется по значениям атрибутов', () => {
    const catalog = makeCatalog(contributionsOf(Orders));
    const created = metricOf(catalog, 'orders.created');

    expect(seriesIndex(created, { tier: 'free', region: 'eu' })).toBe(0);
    expect(seriesIndex(created, { tier: 'paid', region: 'us' })).toBe(3);
  });

  it('значение вне перечня ряда не имеет', () => {
    const catalog = makeCatalog(contributionsOf(Orders));
    const created = metricOf(catalog, 'orders.created');

    expect(
      seriesIndex(created, { tier: 'gold', region: 'eu' }),
    ).toBeUndefined();
  });

  it('ключ открытого ряда собирается из значений по порядку', () => {
    const catalog = makeCatalog([{ group: Queues, owner: "feature 'queues'" }]);
    const received = metricOf(catalog, 'queues.received');

    expect(seriesKey(received, { queue: 'mail' })).not.toBe(
      seriesKey(received, { queue: 'sms' }),
    );
  });
});

describe('каталог — ряды ядра', () => {
  const kernel = [
    { group: KernelMetrics, owner: "kernel module 'kernel:metrics'" },
  ];

  it('ряды запроса заводятся парами «транспорт — шаблон»', () => {
    const catalog = makeCatalog(
      kernel,
      kernelSeries(
        [
          { transport: 'http', pattern: 'GET /users' },
          { transport: 'cli', pattern: 'deploy' },
        ],
        [],
      ),
    );

    const requests = catalog.metric('nestling.requests');

    expect(requests?.width).toBe(8);
    expect(requests?.series).toContainEqual({
      transport: 'http',
      pattern: 'GET /users',
      outcome: 'completed',
    });

    // Произведения перечней здесь нет: шаблон принадлежит своему транспорту
    expect(requests?.series).not.toContainEqual({
      transport: 'cli',
      pattern: 'GET /users',
      outcome: 'completed',
    });
  });

  it('ряды порта заводятся по операциям и обоим биндингам', () => {
    const catalog = makeCatalog(
      kernel,
      kernelSeries([], [{ name: 'orders.create', kind: 'request' }]),
    );

    expect(catalog.metric('nestling.port.calls')?.width).toBe(4);
    expect(catalog.metric('nestling.port.duration')?.series).toContainEqual({
      operation: 'orders.create',
      kind: 'request',
      binding: 'local',
      outcome: 'failed',
    });
  });

  it('приложение без endpoint’ов рядов запроса не имеет', () => {
    const catalog = makeCatalog(kernel, kernelSeries([], []));

    expect(catalog.metric('nestling.requests')?.width).toBe(0);
  });

  it('уточнять перечни метрики без открытого атрибута нечем', () => {
    expect(() =>
      makeCatalog(
        contributionsOf(Orders),
        new Map([['orders.created', [{ tier: 'free', region: 'eu' }]]]),
      ),
    ).toThrow(/declares values for every attribute/);
  });
});
