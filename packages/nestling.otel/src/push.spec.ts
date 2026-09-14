/**
 * Отправка метрик по таймеру.
 *
 * Плагин читает снимок store и отправляет его экспортёру. Своего агрегата
 * у сателлита нет: в экспорте одна область инструментовки, и значения в
 * ней те же, что накопило ядро.
 */

import { CollectedPoints, CollectedSpans } from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import type { Otel } from './options.js';
import { otel } from './otel.js';

import type { MetricsOf, MetricsStore } from '@nestlingjs/app';
import {
  counter,
  DEFAULT_INSTANCE,
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
import { describe, expect, it, vi } from 'vitest';

const OrdersMetrics = makeMetrics('orders', {
  created: counter({ help: 'Created orders' }),
});

@Component([OrdersMetrics])
class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add();
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

const appWith = (telemetry: Otel) =>
  makeApp({
    features: [
      makeFeature({
        name: 'orders',
        metrics: [OrdersMetrics],
        providers: [OrdersService],
        endpoints: [CreateOrder],
      }),
    ],
    plugins: [telemetry.plugin],
    transports: [testTransport()],
  });

/** Store собранного приложения */
const storeOf = (testApp: TestApp): MetricsStore => {
  const store = testApp.get(MetricsStore$);

  if (!store) {
    throw new Error('MetricsStore is not in the graph');
  }

  return store;
};

/** Пауза длиной в несколько интервалов отправки */
const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('отправка метрик по таймеру', () => {
  it('интервал отправляет снимок', async () => {
    const metrics = new CollectedPoints();
    await using testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, intervalMs: 20 })),
    );

    await testApp.call(CreateOrder);
    await wait(70);

    expect(metrics.batches.length).toBeGreaterThan(0);
  });

  it('в экспорте одна область инструментовки — сателлит', async () => {
    const metrics = new CollectedPoints();
    await using testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, intervalMs: 20 })),
    );

    await testApp.call(CreateOrder);
    await wait(70);

    const scopes = metrics.last().scopeMetrics;

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope.name).toBe('@nestlingjs/otel');
  });

  it('значение точки — то, что накопил store', async () => {
    const metrics = new CollectedPoints();
    await using testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, intervalMs: 20 })),
    );

    await testApp.call(CreateOrder);
    await testApp.call(CreateOrder);
    await wait(70);

    const point = metrics
      .last()
      .scopeMetrics[0]?.metrics.find(
        ({ descriptor }) => descriptor.name === 'orders.created',
      )?.dataPoints[0];

    expect(point?.value).toBe(2);
  });

  it('без опции `metrics` store не читается', async () => {
    const traces = new CollectedSpans();
    const testApp = await buildTest(
      appWith(otel({ service: 'orders', traces })),
    );
    const snapshot = vi.spyOn(storeOf(testApp), 'snapshot');

    await testApp.call(CreateOrder);
    await wait(70);
    await testApp.close();

    expect(snapshot).not.toHaveBeenCalled();
    expect(traces.stopped).toBe(true);
  });
});
