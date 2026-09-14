/**
 * Сателлит на собранном приложении: обе части и две картины одного store.
 *
 * Здесь проверяется то, что видно только целиком: запрос проходит,
 * участок и точки уходят экспортёрам, экспозиция и OTLP показывают одни и
 * те же корзины, а два процесса складывают участки в одно дерево.
 *
 * Экспозиция берётся сериализатором `@nestlingjs/prometheus` поверх того
 * же снимка: endpoint формата здесь не нужен, сравниваются числа.
 */

import { CollectedPoints, CollectedSpans } from './__fixtures__/exporters.js';
import { testTransport, TestTransport$ } from './__fixtures__/transport.js';
import type { Otel } from './options.js';
import { otel } from './otel.js';

import { describe, expect, it } from '@jest/globals';
import type { MetricsOf, MetricsStore } from '@nestlingjs/app';
import {
  compose,
  counter,
  DEFAULT_INSTANCE,
  histogram,
  makeApp,
  makeEndpoint,
  makeFeature,
  makeMetrics,
  makePipeline,
  MetricsStore$,
  Ok,
  withTracing,
} from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';
import { serialize } from '@nestlingjs/prometheus';
import type { TestApp } from '@nestlingjs/testing';
import { buildTest } from '@nestlingjs/testing';
import type { HistogramMetricData } from '@opentelemetry/sdk-metrics';

const OrdersMetrics = makeMetrics('orders', {
  created: counter({ help: 'Created orders' }),

  'shipping.duration': histogram({
    help: 'Shipping duration',
    unit: 'ms',
    buckets: [1, 5, 25],
  }),
});

@Component([OrdersMetrics])
class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add();
    this.metrics['shipping.duration'].record(7);
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

/** Приложение с сателлитом: слой участков и плагин push'а */
const appWith = (telemetry: Otel) => {
  const observability = compose(
    makePipeline().pre(withTracing()),
    telemetry.spans,
  );

  const CreateOrder = makeEndpoint({
    transport: TestTransport$(DEFAULT_INSTANCE),
    pattern: 'POST /orders',
    output: 'text',
    pipeline: observability,
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
    plugins: [telemetry.plugin],
    transports: [testTransport()],
  });

  return { app, CreateOrder };
};

/** Store собранного приложения */
const storeOf = (testApp: TestApp): MetricsStore => {
  const store = testApp.get(MetricsStore$);

  if (!store) {
    throw new Error('MetricsStore is not in the graph');
  }

  return store;
};

/** Строка W3C трассы участка */
const traceparent = (traceId: string, spanId: string): string =>
  `00-${traceId}-${spanId}-01`;

/** Накопленные корзины точки: OTLP считает их раздельными */
const cumulative = (counts: readonly number[]): number[] => {
  let running = 0;

  return counts.map((count) => (running += count));
};

/** Значения `le` и счётчики корзин из текста экспозиции */
const expositionBuckets = (text: string): [string, number][] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('orders_shipping_duration_ms_bucket'))
    .map((line) => {
      const le = /le="([^"]+)"/.exec(line)?.[1] as string;
      const count = Number(line.slice(line.lastIndexOf(' ') + 1));

      return [le, count];
    });

describe('приложение с сателлитом', () => {
  it('запрос проходит, участок и точки уходят экспортёрам', async () => {
    const traces = new CollectedSpans();
    const metrics = new CollectedPoints();
    const { app, CreateOrder } = appWith(
      otel({ service: 'orders', traces, metrics }),
    );

    const testApp = await buildTest(app);
    const response = await testApp.call(CreateOrder);

    await testApp.close();

    expect(response.isSuccess).toBe(true);
    expect(traces.only().name).toBe('POST /orders');
    expect(
      metrics
        .last()
        .scopeMetrics[0]?.metrics.map(({ descriptor }) => descriptor.name),
    ).toContain('orders.created');
  });

  it('две картины одного store показывают одни корзины', async () => {
    const metrics = new CollectedPoints();
    const { app, CreateOrder } = appWith(otel({ service: 'orders', metrics }));

    const testApp = await buildTest(app);

    await testApp.call(CreateOrder);

    const exposition = expositionBuckets(
      serialize(storeOf(testApp).snapshot()),
    );

    await testApp.close();

    const point = (
      metrics
        .last()
        .scopeMetrics[0]?.metrics.find(
          ({ descriptor }) => descriptor.name === 'orders.shipping.duration',
        ) as HistogramMetricData
    ).dataPoints[0];

    const { boundaries, counts } = point?.value.buckets as {
      boundaries: number[];
      counts: number[];
    };

    const otlp: [string, number][] = boundaries.map((le, index) => [
      String(le),
      cumulative(counts)[index] as number,
    ]);

    otlp.push(['+Inf', point?.value.count as number]);

    expect(exposition).toEqual(otlp);
  });
});

describe('два процесса — одно дерево', () => {
  it('участок второго процесса ссылается на участок первого', async () => {
    const upstream = new CollectedSpans();
    const downstream = new CollectedSpans();

    const first = appWith(otel({ service: 'orders', traces: upstream }));
    const second = appWith(otel({ service: 'shipping', traces: downstream }));

    await using firstApp = await buildTest(first.app);
    await using secondApp = await buildTest(second.app);

    await firstApp.call(first.CreateOrder);

    const caller = upstream.only().spanContext();

    await secondApp.call(second.CreateOrder, undefined, {
      attributes: { traceparent: traceparent(caller.traceId, caller.spanId) },
    });

    const callee = downstream.only();

    expect(callee.spanContext().traceId).toBe(caller.traceId);
    expect(callee.parentSpanContext?.spanId).toBe(caller.spanId);
  });
});
