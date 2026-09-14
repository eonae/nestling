/**
 * Точки OTLP из снимка store.
 *
 * Проверяется перевод на настоящем store собранного приложения: корзины
 * приходят из декларации метрики, описание и единица — из каталога, а
 * состав рядов задан сборкой, а не трафиком.
 */

import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import { pointsOf } from './points.js';

import { describe, expect, it } from '@jest/globals';
import type { MetricsOf, MetricsSnapshot, MetricsStore } from '@nestlingjs/app';
import {
  counter,
  DEFAULT_INSTANCE,
  histogram,
  makeApp,
  makeEndpoint,
  makeFeature,
  makeMetrics,
  MetricsStore$,
  Ok,
} from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';
import type { TestApp } from '@nestlingjs/testing';
import { buildTest } from '@nestlingjs/testing';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type {
  HistogramMetricData,
  MetricData,
  SumMetricData,
} from '@opentelemetry/sdk-metrics';
import { DataPointType } from '@opentelemetry/sdk-metrics';

const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'] },
  }),

  'shipping.duration': histogram({
    help: 'Shipping duration',
    unit: 'ms',
    buckets: [1, 5, 25],
    attributes: { tier: ['free', 'paid'] },
  }),
});

@Component([OrdersMetrics])
class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add({ tier: 'paid' });
    this.metrics['shipping.duration'].record(7, { tier: 'paid' });
  }
}

@Handler([OrdersService])
class CreateOrderHandler {
  constructor(private readonly orders: OrdersService) {}

  async handle() {
    this.orders.create();

    return new Ok('done');
  }
}

const CreateOrder = makeEndpoint({
  transport: TestTransport$(DEFAULT_INSTANCE),
  pattern: 'POST /orders',
  output: 'text',
  handler: CreateOrderHandler,
});

const app = makeApp({
  features: [
    makeFeature({
      name: 'orders',
      metrics: [OrdersMetrics],
      providers: [OrdersService],
      endpoints: [CreateOrder],
    }),
  ],
  transports: [testTransport()],
});

/** Ресурс спеки: атрибуты здесь не предмет проверки */
const resource = resourceFromAttributes({ 'service.name': 'orders' });

/** Точки одной метрики по её полному имени */
const metricOf = (snapshot: MetricsSnapshot, name: string): MetricData => {
  const points = pointsOf(snapshot, resource, [0, 0], [1, 0]);
  const found = points.scopeMetrics[0]?.metrics.find(
    (metric) => metric.descriptor.name === name,
  );

  if (!found) {
    throw new Error(`metric '${name}' is not in the export`);
  }

  return found;
};

/** Store собранного приложения */
const storeOf = (testApp: TestApp): MetricsStore => {
  const store = testApp.get(MetricsStore$);

  if (!store) {
    throw new Error('MetricsStore is not in the graph');
  }

  return store;
};

describe('перевод снимка в точки', () => {
  it('корзины точки — границы декларации', async () => {
    await using testApp = await buildTest(app);

    await testApp.call(CreateOrder);

    const metric = metricOf(
      storeOf(testApp).snapshot(),
      'orders.shipping.duration',
    ) as HistogramMetricData;

    expect(metric.dataPointType).toBe(DataPointType.HISTOGRAM);

    const point = metric.dataPoints.find(
      ({ attributes }) => attributes.tier === 'paid',
    );

    expect(point?.value.buckets.boundaries).toEqual([1, 5, 25]);
    expect(point?.value.buckets.counts).toEqual([0, 0, 1, 0]);
    expect(point?.value.count).toBe(1);
    expect(point?.value.sum).toBe(7);
  });

  it('описание и единица доходят до точки', async () => {
    await using testApp = await buildTest(app);

    const metric = metricOf(
      storeOf(testApp).snapshot(),
      'orders.shipping.duration',
    );

    expect(metric.descriptor.description).toBe('Shipping duration');
    expect(metric.descriptor.unit).toBe('ms');
  });

  it('ряды видны до первой записи', async () => {
    await using testApp = await buildTest(app);

    const metric = metricOf(
      storeOf(testApp).snapshot(),
      'orders.created',
    ) as SumMetricData;

    expect(metric.isMonotonic).toBe(true);
    expect(
      metric.dataPoints.map(({ attributes, value }) => [
        attributes.tier,
        value,
      ]),
    ).toEqual([
      ['free', 0],
      ['paid', 0],
    ]);
  });

  it('счётчик ядра приходит суммой с атрибутами запроса', async () => {
    await using testApp = await buildTest(app);

    await testApp.call(CreateOrder);

    const metric = metricOf(
      storeOf(testApp).snapshot(),
      'nestling.requests',
    ) as SumMetricData;

    const point = metric.dataPoints.find(
      ({ attributes }) => attributes.outcome === 'completed',
    );

    expect(point?.attributes).toMatchObject({
      transport: 'test',
      pattern: 'POST /orders',
      outcome: 'completed',
    });
    expect(point?.value).toBe(1);
  });
});
