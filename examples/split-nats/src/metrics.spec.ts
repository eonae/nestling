/**
 * Адаптер метрик: сложение записей, формат экспозиции и метрики ядра.
 *
 * Проверяется то, ради чего адаптер живёт в примере: публичной границы
 * ядра хватает стороннему экспортёру — он получает и записи приложения, и
 * счётчики, которые ядро пишет само.
 */

import { metricsPlugin, prometheusExporter } from './metrics.js';
import { RegisterUser } from './operations.js';
import { QuotasFeature } from './quotas.js';
import { UsersFeature } from './users.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition } from '@nestlingjs/app';
import { makeApp } from '@nestlingjs/app';
import { assembleTest } from '@nestlingjs/testing';
import { http } from '@nestlingjs/transport.http';

describe('адаптер Prometheus', () => {
  it('складывает счётчики по имени и меткам', () => {
    const exporter = prometheusExporter();

    exporter.counter('orders.created');
    exporter.counter('orders.created', 2);
    exporter.counter('orders.created', 1, { tenant: 'acme' });

    const text = exporter.render();

    expect(text).toContain('orders_created 3');
    expect(text).toContain('orders_created{tenant="acme"} 1');
  });

  it('гистограмма даёт число наблюдений и сумму', () => {
    const exporter = prometheusExporter();

    exporter.histogram('db.query', 10, { table: 'users' });
    exporter.histogram('db.query', 5, { table: 'users' });

    const text = exporter.render();

    expect(text).toContain('db_query_count{table="users"} 2');
    expect(text).toContain('db_query_sum{table="users"} 15.000');
  });

  it('метки печатаются в одном порядке независимо от порядка записи', () => {
    const exporter = prometheusExporter();

    exporter.counter('x', 1, { b: '2', a: '1' });
    exporter.counter('x', 1, { a: '1', b: '2' });

    expect(exporter.render()).toContain('x{a="1",b="2"} 2');
  });
});

describe('метрики ядра в экспорте примера', () => {
  it('обработка операции попадает в экспорт счётчиком и длительностью', async () => {
    const exporter = prometheusExporter();
    const plugin = metricsPlugin(exporter);

    // Шины в этой сборке нет: обе фичи выбраны, и вызов `quotas.claim`
    // идёт через `dispatch` — метрика порта при этом пишется та же
    const observed = makeApp({
      features: [UsersFeature, QuotasFeature],
      plugins: [plugin],
      transports: [http()],
      metrics: exporter,
    });

    await using testApp = await assembleTest(observed, { args: 'all' });

    await testApp.emit(RegisterUser, { email: 'alice@example.com' });

    const text = exporter.render();

    expect(text).toContain('nestling_requests{');
    expect(text).toContain('nestling_request_duration_count{');
    expect(text).toMatch(/nestling_port_calls{[^}]*binding="local"/);
  });

  it('endpoint /metrics отдаёт накопленный текст', async () => {
    const exporter = prometheusExporter();
    const plugin = metricsPlugin(exporter);
    const observed = makeApp({
      features: [UsersFeature, QuotasFeature],
      plugins: [plugin],
      transports: [http()],
      metrics: exporter,
    });

    exporter.counter('orders.created', 7);

    await using testApp = await assembleTest(observed, { args: 'all' });

    const [endpoint] = plugin.endpoints as readonly AnyEndpointDefinition[];
    const response = await testApp.call(endpoint);

    expect(response.isSuccess).toBe(true);
    expect(String(response.value)).toContain('orders_created 7');
  });
});
