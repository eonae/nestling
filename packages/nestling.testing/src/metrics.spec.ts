/**
 * Метрики тестового прогона: тест читает снимок store.
 *
 * Подмены корня нет и не нужно: записи приложения и записи ядра лежат в
 * одном store, а ряд адресуется членом группы.
 */

import { HTTP_LIKE, SpyTransport } from './__fixtures__/transport.js';
import { buildTest } from './app.js';

import { describe, expect, it } from '@jest/globals';
import type { ITransport, MetricsOf } from '@nestlingjs/app';
import {
  counter,
  histogram,
  KernelMetrics,
  makeApp,
  makeFeature,
  makeMetrics,
  Ok,
  open,
  transportValue,
} from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';
import { httpEndpoint, HttpTransport$ } from '@nestlingjs/transport.http';
import { z } from 'zod';

const UsersMetrics = makeMetrics('users', {
  created: counter({
    help: 'Created users',
    attributes: { tier: ['free', 'paid'], source: open },
  }),

  'create.duration': histogram({ unit: 'ms', buckets: [10, 100] }),
});

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: HTTP_LIKE,
  });

@Component([UsersMetrics])
class UsersService {
  constructor(private readonly metrics: MetricsOf<typeof UsersMetrics>) {}

  create(): void {
    this.metrics.created.add({ tier: 'paid', source: 'web' });
    this.metrics['create.duration'].record(42);
  }
}

const usersApp = () =>
  makeApp({
    features: [
      makeFeature({
        name: 'users',
        metrics: [UsersMetrics],
        providers: [UsersService],
      }),
    ],
  });

describe('метрики тестового приложения', () => {
  it('запись сервиса видна тесту', async () => {
    await using testApp = await buildTest(usersApp());

    testApp.get(UsersService)?.create();

    expect(
      testApp.metrics.counter(UsersMetrics.members.created, { tier: 'paid' }),
    ).toBe(1);
  });

  it('ряд, в который не писали, читается нулём', async () => {
    await using testApp = await buildTest(usersApp());

    expect(
      testApp.metrics.counter(UsersMetrics.members.created, { tier: 'free' }),
    ).toBe(0);
  });

  it('гистограмма читается агрегатом', async () => {
    await using testApp = await buildTest(usersApp());

    testApp.get(UsersService)?.create();

    expect(
      testApp.metrics.histogram(UsersMetrics.members['create.duration']),
    ).toMatchObject({
      count: 1,
      sum: 42,
      buckets: [
        { le: 10, count: 0 },
        { le: 100, count: 1 },
      ],
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

    await using testApp = await buildTest(app);

    await testApp.call(Ping);

    expect(
      testApp.metrics.counter(KernelMetrics.members.requests, {
        transport: 'http',
        pattern: 'GET /ping',
        outcome: 'completed',
      }),
    ).toBe(1);
  });

  it('снимок несёт ряды прогона: заведённые сборкой и появившиеся записью', async () => {
    await using testApp = await buildTest(usersApp());

    const namesOf = () =>
      testApp.metrics
        .snapshot()
        .map(({ name }) => name)
        .filter((name) => name.startsWith('users.'));

    // У `created` есть открытый атрибут, поэтому её рядов до записи нет
    expect(namesOf()).toEqual(['users.create.duration']);

    testApp.get(UsersService)?.create();

    expect(namesOf()).toEqual(['users.created', 'users.create.duration']);
  });
});
