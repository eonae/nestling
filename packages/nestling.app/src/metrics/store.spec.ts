/**
 * Store: нули до записи, ряды открытых атрибутов и снимок.
 */

import { makeCatalog } from './catalog.js';
import { counter, histogram, makeMetrics, open } from './declaration.js';
import { findSeries, findSeriesOne } from './lookup.js';
import { MetricsStore } from './store.js';
import { makeWriter } from './writer.js';

import { describe, expect, it } from '@jest/globals';

const Orders = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'] },
  }),

  'checkout.duration': histogram({ unit: 'ms', buckets: [10, 100] }),

  received: counter({ attributes: { queue: open } }),
});

const { created, received } = Orders.members;
const duration = Orders.members['checkout.duration'];

/** Store с каталогом одной группы и писателем к нему */
const storeOf = () => {
  const store = new MetricsStore(
    makeCatalog([{ group: Orders, owner: "feature 'orders'" }]),
  );

  return { store, metrics: makeWriter(Orders, store) };
};

describe('store — ряды до первой записи', () => {
  it('ряды объявленных атрибутов есть со значением ноль', () => {
    const { store } = storeOf();

    expect(findSeries(store.snapshot(), created)).toEqual([
      {
        name: 'orders.created',
        help: 'Created orders',
        kind: 'counter',
        attributes: { tier: 'free' },
        value: 0,
      },
      {
        name: 'orders.created',
        help: 'Created orders',
        kind: 'counter',
        attributes: { tier: 'paid' },
        value: 0,
      },
    ]);
  });

  it('гистограмма без наблюдений несёт нулевые корзины', () => {
    const { store } = storeOf();

    expect(findSeriesOne(store.snapshot(), duration)).toMatchObject({
      kind: 'histogram',
      unit: 'ms',
      count: 0,
      sum: 0,
      buckets: [
        { le: 10, count: 0 },
        { le: 100, count: 0 },
      ],
    });
  });

  it('ряда открытого атрибута до записи нет', () => {
    const { store } = storeOf();

    expect(findSeries(store.snapshot(), received)).toEqual([]);
  });
});

describe('store — запись', () => {
  it('счётчик растёт по объявленному ряду', () => {
    const { store, metrics } = storeOf();

    metrics.created.add(2, { tier: 'paid' });
    metrics.created.add({ tier: 'paid' });

    expect(
      findSeriesOne(store.snapshot(), created, { tier: 'paid' }),
    ).toMatchObject({
      value: 3,
    });
    expect(
      findSeriesOne(store.snapshot(), created, { tier: 'free' }),
    ).toMatchObject({
      value: 0,
    });
  });

  it('ряд открытого атрибута заводится первой записью', () => {
    const { store, metrics } = storeOf();

    metrics.received.add(1, { queue: 'mail' });
    metrics.received.add(1, { queue: 'mail' });
    metrics.received.add(1, { queue: 'sms' });

    expect(findSeries(store.snapshot(), received)).toEqual([
      {
        name: 'orders.received',
        kind: 'counter',
        attributes: { queue: 'mail' },
        value: 2,
      },
      {
        name: 'orders.received',
        kind: 'counter',
        attributes: { queue: 'sms' },
        value: 1,
      },
    ]);
  });

  it('гистограмма несёт счётчик, сумму и корзины декларации', () => {
    const { store, metrics } = storeOf();

    metrics['checkout.duration'].record(5);
    metrics['checkout.duration'].record(42);
    metrics['checkout.duration'].record(500);

    expect(findSeriesOne(store.snapshot(), duration)).toMatchObject({
      count: 3,
      sum: 547,
      buckets: [
        { le: 10, count: 1 },
        { le: 100, count: 2 },
      ],
    });
  });

  it('снимок не меняется задним числом', () => {
    const { store, metrics } = storeOf();

    metrics.created.add({ tier: 'free' });
    const taken = store.snapshot();

    metrics.created.add({ tier: 'free' });

    expect(findSeriesOne(taken, created, { tier: 'free' })).toMatchObject({
      value: 1,
    });
    expect(
      findSeriesOne(store.snapshot(), created, { tier: 'free' }),
    ).toMatchObject({ value: 2 });
  });
});

describe('store — писатель', () => {
  it('группа вне каталога писателя не получает', () => {
    const { store } = storeOf();
    const Foreign = makeMetrics('foreign', { hits: counter() });

    expect(() => makeWriter(Foreign, store)).toThrow(
      /'Metrics:foreign' is not in the build catalog/,
    );
  });
});
