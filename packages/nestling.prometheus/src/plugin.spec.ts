/**
 * Плагин экспозиции на собранном приложении: нули до трафика, адрес и
 * отделённость endpoint'а от API приложения.
 */

import { prometheus } from './plugin.js';

import { describe, expect, it } from '@jest/globals';
import type {
  AnyEndpointDefinition,
  MetricsOf,
  Plugin,
  ResponseContext,
} from '@nestlingjs/app';
import {
  counter,
  everyEndpoint,
  makeApp,
  makeFeature,
  makeMetrics,
  makePipeline,
  Ok,
} from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';
import { buildTest } from '@nestlingjs/testing';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'] },
  }),
});

@Component([OrdersMetrics])
class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add({ tier: 'paid' });
  }
}

@Handler([OrdersService])
class CreateOrderHandler {
  constructor(private readonly orders: OrdersService) {}

  async handle() {
    this.orders.create();

    return new Ok({ ok: true });
  }
}

/** Слой приложения: его требует политика в последней спеке */
const observability = makePipeline().pre(() => ({ traced: true }));

const CreateOrder = httpEndpoint.post('/orders', {
  output: z.object({ ok: z.boolean() }),
  pipeline: observability,
  handler: CreateOrderHandler,
});

const Orders = makeFeature({
  name: 'orders',
  metrics: [OrdersMetrics],
  providers: [OrdersService],
  endpoints: [CreateOrder],
});

const appWith = (plugin: Plugin) =>
  makeApp({ features: [Orders], plugins: [plugin], transports: [http()] });

/** Декларация экспозиции: единственный endpoint плагина */
const expositionOf = (plugin: Plugin): AnyEndpointDefinition =>
  plugin.endpoints[0] as AnyEndpointDefinition;

/** Текст ответа endpoint'а экспозиции */
const scrape = async (
  testApp: { call: (endpoint: never) => Promise<ResponseContext> },
  endpoint: AnyEndpointDefinition,
): Promise<string> => {
  const response = await testApp.call(endpoint as never);

  return response.value as string;
};

describe('плагин экспозиции', () => {
  it('свежее приложение отдаёт нули по каждому endpoint’у и исходу', async () => {
    const plugin = prometheus();
    await using testApp = await buildTest(appWith(plugin));

    const text = await scrape(testApp, expositionOf(plugin));

    expect(text).toContain(
      'nestling_requests{outcome="completed",pattern="POST /orders",transport="http"} 0',
    );
    expect(text).toContain(
      'nestling_requests{outcome="failed",pattern="POST /orders",transport="http"} 0',
    );
  });

  it('запись приложения видна в экспозиции', async () => {
    const plugin = prometheus();
    await using testApp = await buildTest(appWith(plugin));

    await testApp.call(CreateOrder);

    expect(await scrape(testApp, expositionOf(plugin))).toContain(
      'orders_created{tier="paid"} 1',
    );
  });

  it('описание метрики уходит в HELP и TYPE', async () => {
    const plugin = prometheus();
    await using testApp = await buildTest(appWith(plugin));

    const text = await scrape(testApp, expositionOf(plugin));

    expect(text).toContain('# HELP orders_created Created orders');
    expect(text).toContain('# TYPE orders_created counter');
  });

  it('гистограмма ядра выводится корзинами', async () => {
    const plugin = prometheus();
    await using testApp = await buildTest(appWith(plugin));

    await testApp.call(CreateOrder);

    const text = await scrape(testApp, expositionOf(plugin));

    expect(text).toContain('nestling_request_duration_ms_bucket{');
    expect(text).toContain('nestling_request_duration_ms_count{');
  });

  it('адрес экспозиции меняется опцией', async () => {
    const plugin = prometheus({ path: '/internal/metrics' });
    await using testApp = await buildTest(appWith(plugin));

    expect(expositionOf(plugin).pattern).toBe('GET /internal/metrics');
    expect(await scrape(testApp, expositionOf(plugin))).toContain(
      '# TYPE nestling_requests counter',
    );
  });
});

describe('endpoint экспозиции отделён от API', () => {
  it('пути экспозиции нет в документе OpenAPI', () => {
    const docs = openapi({
      info: { title: 'Orders', version: '1.0.0' },
      converters: [zodConverter()],
      announceHidden: false,
    });

    const app = makeApp({
      features: [Orders],
      plugins: [prometheus(), docs],
      transports: [http()],
    });

    expect(Object.keys(docs.document(app.discover()).paths)).toEqual([
      '/orders',
    ]);
  });

  it('политика слоя экспозицию не трогает', async () => {
    const app = makeApp({
      features: [Orders],
      plugins: [prometheus()],
      transports: [http()],
      policies: [everyEndpoint().hasLayer(observability, 'observability')],
    });

    await using testApp = await buildTest(app);

    expect(testApp.features).toEqual(['orders']);
  });
});
