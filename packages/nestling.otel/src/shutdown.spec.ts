/**
 * Остановка приложения: последний снимок и закрытие экспортёров.
 *
 * Освобождение ресурса снимает таймер, отправляет снимок и закрывает
 * экспортёров. Записи последнего интервала не теряются: store
 * освобождается позже сателлита, потому что сателлит от него зависит.
 */

import {
  CollectedPoints,
  CollectedSpans,
  FailingPoints,
} from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import type { Otel } from './options.js';
import { otel } from './otel.js';

import { describe, expect, it } from '@jest/globals';
import type { MetricsOf } from '@nestlingjs/app';
import {
  counter,
  DEFAULT_INSTANCE,
  makeApp,
  makeEndpoint,
  makeFeature,
  makeMetrics,
  Ok,
  RootLogger$,
} from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';
import type { LogEntry } from '@nestlingjs/testing';
import { buildTest, spyLogger } from '@nestlingjs/testing';

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

/** Значение счётчика заказов в последней отправке */
const created = (metrics: CollectedPoints): number | undefined =>
  metrics
    .last()
    .scopeMetrics[0]?.metrics.find(
      ({ descriptor }) => descriptor.name === 'orders.created',
    )?.dataPoints[0]?.value as number | undefined;

/** Пауза длиной в несколько интервалов отправки */
const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('остановка приложения', () => {
  it('записи последнего интервала уходят снимком', async () => {
    const metrics = new CollectedPoints();
    const testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, intervalMs: 60_000 })),
    );

    await testApp.call(CreateOrder);
    await testApp.close();

    expect(created(metrics)).toBe(1);
  });

  it('экспортёры закрываются оба', async () => {
    const metrics = new CollectedPoints();
    const traces = new CollectedSpans();
    const testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, traces })),
    );

    await testApp.close();

    expect(metrics.stopped).toBe(true);
    expect(traces.stopped).toBe(true);
  });

  it('таймер снят: после остановки отправок больше нет', async () => {
    const metrics = new CollectedPoints();
    const testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics, intervalMs: 20 })),
    );

    await testApp.close();

    const sent = metrics.batches.length;

    await wait(70);

    expect(metrics.batches).toHaveLength(sent);
  });

  it('отказ отправки уходит в логгер и не срывает остановку', async () => {
    const spy = spyLogger();
    const metrics = new FailingPoints();
    const testApp = await buildTest(
      appWith(otel({ service: 'orders', metrics })),
      {
        overrides: [[RootLogger$, spy.logger]],
      },
    );

    await expect(testApp.close()).resolves.toBeUndefined();

    expect(metrics.attempts).toBe(1);
    expect(
      spy.entries.filter((entry: LogEntry) => entry.level === 'warn'),
    ).toHaveLength(1);
  });
});
