/**
 * `spyMetrics()`: записи значениями и подмена корня в тестовом прогоне.
 *
 * Подмена делает две вещи сразу — перехватывает записи приложения и
 * включает инструментовку ядра: под корнем оказывается не пустая
 * реализация.
 */

import { HTTP_LIKE, SpyTransport } from './__fixtures__/transport.js';
import { buildTest } from './app.js';
import { spyMetrics } from './metrics.js';

import { describe, expect, it } from '@jest/globals';
import type { ITransport, Metrics } from '@nestlingjs/app';
import {
  makeApp,
  makeFeature,
  Metrics$,
  Ok,
  RootMetrics$,
  transportValue,
} from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';
import { httpEndpoint, HttpTransport$ } from '@nestlingjs/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: HTTP_LIKE,
  });

describe('spyMetrics — записи значениями', () => {
  it('копит обе формы записи', () => {
    const spy = spyMetrics();

    spy.metrics.counter('orders.created');
    spy.metrics.counter('orders.created', 3, { tenant: 'acme' });
    spy.metrics.histogram('db.query', 12, { table: 'users' });

    expect(spy.records).toEqual([
      { kind: 'counter', name: 'orders.created', value: 1, attributes: {} },
      {
        kind: 'counter',
        name: 'orders.created',
        value: 3,
        attributes: { tenant: 'acme' },
      },
      {
        kind: 'histogram',
        name: 'db.query',
        value: 12,
        attributes: { table: 'users' },
      },
    ]);
  });
});

describe('spyMetrics — подмена корня', () => {
  it('перехватывает записи токена семейства вместе с областью', async () => {
    @Component([Metrics$.auto])
    class UsersService {
      constructor(private readonly metrics: Metrics) {}

      create(): void {
        this.metrics.counter('created');
      }
    }

    const app = makeApp({
      features: [makeFeature({ name: 'users', providers: [UsersService] })],
    });

    const spy = spyMetrics();
    await using testApp = await buildTest(app, {
      overrides: [[RootMetrics$, spy.metrics]],
    });

    testApp.get(UsersService)?.create();

    expect(spy.records).toContainEqual({
      kind: 'counter',
      name: 'created',
      value: 1,
      attributes: { scope: 'UsersService' },
    });
  });

  it('метрики ядра видны тесту', async () => {
    const Ping = httpEndpoint.get('/ping', {
      output: z.object({ ok: z.boolean() }),
      handler: async () => new Ok({ ok: true }),
    });

    const app = makeApp({
      features: [makeFeature({ name: 'ping', endpoints: [Ping] })],
      transports: [asHttpTransport(new SpyTransport())],
    });

    const spy = spyMetrics();
    await using testApp = await buildTest(app, {
      overrides: [[RootMetrics$, spy.metrics]],
    });

    await testApp.call(Ping);

    expect(spy.records).toContainEqual(
      expect.objectContaining({
        kind: 'counter',
        name: 'nestling.requests',
        attributes: expect.objectContaining({
          transport: 'http',
          pattern: 'GET /ping',
          outcome: 'completed',
        }),
      }),
    );
  });
});
