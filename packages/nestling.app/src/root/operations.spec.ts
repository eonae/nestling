/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-заглушки `console`: тест смотрит на состав напечатанного, а не на
 * сам вывод. */
/**
 * Карта операций в отчёте `check()`: что реализовано здесь, что уходит
 * наружу и через какой интерком.
 */

import type { Port } from '../ports/index.js';
import { BusTransport$, implement, InProcessBus } from '../ports/index.js';
import { transportValue } from '../transport/index.js';

import { testEndpoint, TestTransport$ } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { describe, expect, it, jest } from '@jest/globals';
import { Injectable, makeToken } from '@nestling/container';
import { makeRequest } from '@nestling/operations';
import { Ok } from '@nestling/pipeline';
import { z } from 'zod';

const asTransport = (transport: MockTransport) =>
  transportValue(TestTransport$('default'), transport);

/** Шина, доставляющая за пределы процесса: вход remote-биндинга */
class RemoteBus extends InProcessBus {
  override readonly remote: boolean = true;
}

const asBus = () =>
  transportValue(BusTransport$, new RemoteBus(), {
    name: 'events',
    bus: true,
  });

/** Токен сервиса-вызывателя: операцию зовёт провайдер, а не декларация */
const SignupToken = makeToken<{ quotas: unknown }>('SignupService');

const ClaimQuota = makeRequest({
  name: 'map.quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
});

const QuotasFeature = makeFeature({
  name: 'quotas',
  endpoints: [
    implement(ClaimQuota, { handler: async () => new Ok({ granted: 1 }) }),
  ],
});

@Injectable([ClaimQuota.caller])
class PlaceOrderHandler {
  constructor(private readonly quotas: Port<typeof ClaimQuota>) {}

  async handle() {
    await this.quotas.call({ amount: 1 });

    return new Ok({});
  }
}

const OrdersFeature = makeFeature({
  name: 'orders',
  endpoints: [
    testEndpoint({
      method: 'POST',
      path: '/orders',
      handler: PlaceOrderHandler,
    }),
  ],
});

describe('карта операций в отчёте check()', () => {
  it('называет реализованное здесь и вызываемое', async () => {
    const report = await makeApp({
      features: [OrdersFeature, QuotasFeature],
      transports: [asTransport(new MockTransport())],
    }).check();

    expect(report.operations).toEqual([
      {
        name: 'map.quotas.claim',
        kind: 'request',
        implemented: true,
        called: true,
      },
    ]);
  });

  it('вызов без местной реализации уходит через назначенный интерком', async () => {
    const report = await makeApp({
      features: [OrdersFeature, QuotasFeature],
      transports: [asTransport(new MockTransport()), asBus()],
      intercom: 'events',
    }).check('orders');

    expect(report.operations).toEqual([
      {
        name: 'map.quotas.claim',
        kind: 'request',
        implemented: false,
        called: true,
        via: 'events',
      },
    ]);
  });

  it('интерком без операций даёт предупреждение, а не ошибку', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const Silent = makeFeature({
      name: 'silent',
      endpoints: [
        testEndpoint({
          method: 'GET',
          path: '/health',
          handler: async () => new Ok({}),
        }),
      ],
    });

    const app = makeApp({
      features: [Silent],
      transports: [asTransport(new MockTransport()), asBus()],
      intercom: 'events',
    }).assemble();

    await app.run();

    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /intercom 'events' is assigned, but this assembly declares no operations/,
    );

    await app.close();
    warn.mockRestore();
    log.mockRestore();
  });

  it('видит вызов, объявленный провайдером, а не декларацией', async () => {
    const CallerFeature = makeFeature({
      name: 'caller',
      providers: [
        {
          provide: SignupToken,
          useFactory: (quotas: Port<typeof ClaimQuota>) => ({ quotas }),
          deps: [ClaimQuota.caller],
        },
      ],
    });

    const report = await makeApp({
      features: [CallerFeature, QuotasFeature],
      transports: [asTransport(new MockTransport())],
    }).check();

    expect(report.operations).toEqual([
      {
        name: 'map.quotas.claim',
        kind: 'request',
        implemented: true,
        called: true,
      },
    ]);
  });
});
