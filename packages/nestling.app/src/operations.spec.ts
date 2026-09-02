/**
 * Карта операций в отчёте `check()`: что реализовано здесь, что уходит
 * наружу и через какой интерком.
 */

import { assemble } from './app';
import { makeFeature } from './feature';
import { MockTransport } from './helpers';

import { describe, expect, it } from '@jest/globals';
import { makeRequest } from '@nestling/operations';
import { Ok } from '@nestling/pipeline';
import type { Port } from '@nestling/ports';
import { BusTransport$, implement, InProcessBus } from '@nestling/ports';
import { transportValue } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: MockTransport) =>
  transportValue(HttpTransport$('default'), transport);

/** Шина, доставляющая за пределы процесса: вход remote-биндинга */
class RemoteBus extends InProcessBus {
  override readonly remote: boolean = true;
}

const asBus = () =>
  transportValue(BusTransport$, new RemoteBus(), {
    name: 'events',
    bus: true,
  });

const ClaimQuota = makeRequest({
  name: 'map.quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
});

const QuotasFeature = makeFeature({
  name: 'quotas',
  endpoints: [
    implement(ClaimQuota, { handle: async () => new Ok({ granted: 1 }) }),
  ],
});

const OrdersFeature = makeFeature({
  name: 'orders',
  endpoints: [
    httpEndpoint({
      method: 'POST',
      path: '/orders',
      deps: [ClaimQuota.caller],
      handle: (quotas: Port<typeof ClaimQuota>) => async () => {
        await quotas.call({ amount: 1 });

        return new Ok({});
      },
    }),
  ],
});

describe('карта операций в отчёте check()', () => {
  it('называет реализованное здесь и вызываемое', async () => {
    const report = await assemble({
      features: [OrdersFeature, QuotasFeature],
      transports: [asHttpTransport(new MockTransport())],
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
    const report = await assemble({
      features: [OrdersFeature, QuotasFeature],
      select: 'orders',
      transports: [asHttpTransport(new MockTransport()), asBus()],
      intercom: 'events',
    }).check();

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
});
