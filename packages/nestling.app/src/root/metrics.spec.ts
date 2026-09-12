/**
 * Корень метрик приложения: опция корня, члены семейства и запрет второго
 * объявления.
 *
 * Проверяется та же схема, что у логгера, — и это предмет проверки:
 * приложение узнаёт метрики по уже знакомой форме.
 */

import { spyMetrics } from '../metrics/__fixtures__/spy.js';
import type { Metrics } from '../metrics/index.js';
import { Metrics$, RootMetrics$ } from '../metrics/index.js';
import { Ok } from '../pipeline/index.js';
import { transportValue } from '../transport/index.js';

import {
  testEndpoint,
  TestTransport$,
  VALUE_ONLY,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it } from '@jest/globals';
import {
  Component,
  factoryProvider,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';
import { z } from 'zod';

const asTransport = (transport: MockTransport) =>
  transportValue(TestTransport$('default'), transport, {
    capabilities: VALUE_ONLY,
  });

const ping = () =>
  testEndpoint({
    method: 'GET',
    path: '/ping',
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

const Service$ = makeToken<unknown>('Service');

/** Провайдер, который пишет счётчик из названного члена семейства */
const writerOf = (scope: string) =>
  factoryProvider(
    Service$,
    (metrics: Metrics) => {
      metrics.counter('created');

      return {};
    },
    [Metrics$(scope)] as const,
  );

describe('корень метрик', () => {
  it('член семейства добавляет область к записи', async () => {
    const spy = spyMetrics();

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [writerOf('users')],
      metrics: spy.metrics,
    }).assemble();

    await app.run();
    await app.close();

    expect(spy.records).toContainEqual({
      kind: 'counter',
      name: 'created',
      value: 1,
      attributes: { scope: 'users' },
    });
  });

  it('.auto даёт члена по имени класса-потребителя', async () => {
    const spy = spyMetrics();

    @Component([Metrics$.auto])
    class OrdersService {
      constructor(metrics: Metrics) {
        metrics.counter('created');
      }
    }

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [OrdersService],
      metrics: spy.metrics,
    }).assemble();

    await app.run();
    await app.close();

    expect(spy.records).toContainEqual({
      kind: 'counter',
      name: 'created',
      value: 1,
      attributes: { scope: 'OrdersService' },
    });
  });

  it('без опции запись проходит и никуда не уходит', async () => {
    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [writerOf('users')],
    }).assemble();

    await expect(app.run()).resolves.toBeUndefined();
    await app.close();
  });

  it('провайдер под RootMetrics$ отвергается, называя опцию корня', async () => {
    const spy = spyMetrics();

    const app = makeApp({
      endpoints: [ping()],
      transports: [asTransport(new MockTransport())],
      providers: [valueProvider(RootMetrics$, spy.metrics)],
    }).assemble();

    await expect(app.run()).rejects.toThrow(
      /metrics root is set by the 'metrics' option of makeApp/,
    );
  });
});
