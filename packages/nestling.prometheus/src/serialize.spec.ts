/**
 * Формат экспозиции: имена, метки, описание метрики и корзины.
 */

import { serialize } from './serialize.js';

import type { MetricsSnapshot } from '@nestlingjs/app';
import { describe, expect, it } from 'vitest';

const snapshot: MetricsSnapshot = [
  {
    name: 'nestling.requests',
    kind: 'counter',
    help: 'Handled requests',
    attributes: { pattern: 'GET /users', transport: 'http', outcome: 'failed' },
    value: 0,
  },
  {
    name: 'nestling.requests',
    kind: 'counter',
    help: 'Handled requests',
    attributes: {
      pattern: 'GET /users',
      transport: 'http',
      outcome: 'completed',
    },
    value: 3,
  },
  {
    name: 'orders.checkout.duration',
    kind: 'histogram',
    help: 'Checkout duration',
    unit: 'ms',
    attributes: { step: 'charge' },
    count: 2,
    sum: 57,
    buckets: [
      { le: 10, count: 1 },
      { le: 100, count: 2 },
    ],
  },
];

describe('экспозиция — имена и метки', () => {
  it('точки имени становятся подчёркиваниями', () => {
    expect(serialize(snapshot)).toContain('nestling_requests{');
  });

  it('единица измерения уходит в имя ряда', () => {
    expect(serialize(snapshot)).toContain('orders_checkout_duration_ms_sum');
  });

  it('метки идут в устойчивом порядке', () => {
    expect(serialize(snapshot)).toContain(
      'nestling_requests{outcome="failed",pattern="GET /users",transport="http"} 0',
    );
  });

  it('ряд со значением ноль попадает в экспозицию', () => {
    expect(serialize(snapshot)).toContain(
      'nestling_requests{outcome="failed",pattern="GET /users",transport="http"} 0',
    );
  });
});

describe('экспозиция — описание метрики', () => {
  it('метрика получает HELP и TYPE один раз', () => {
    const text = serialize(snapshot);

    expect(text.match(/# HELP nestling_requests Handled requests/g)).toEqual([
      '# HELP nestling_requests Handled requests',
    ]);
    expect(text).toContain('# TYPE nestling_requests counter');
    expect(text).toContain('# TYPE orders_checkout_duration_ms histogram');
  });

  it('метрика без описания несёт только TYPE', () => {
    const text = serialize([
      {
        name: 'queues.received',
        kind: 'counter',
        attributes: { queue: 'mail' },
        value: 1,
      },
    ]);

    expect(text).not.toContain('# HELP');
    expect(text).toContain('# TYPE queues_received counter');
  });
});

describe('экспозиция — гистограмма', () => {
  it('выводится корзинами, суммой и счётчиком', () => {
    const text = serialize(snapshot);

    expect(text).toContain(
      'orders_checkout_duration_ms_bucket{step="charge",le="10"} 1',
    );
    expect(text).toContain(
      'orders_checkout_duration_ms_bucket{step="charge",le="100"} 2',
    );
    expect(text).toContain(
      'orders_checkout_duration_ms_bucket{step="charge",le="+Inf"} 2',
    );
    expect(text).toContain('orders_checkout_duration_ms_sum{step="charge"} 57');
    expect(text).toContain(
      'orders_checkout_duration_ms_count{step="charge"} 2',
    );
  });
});

describe('экспозиция — граничные случаи', () => {
  it('пустой снимок даёт пустой текст', () => {
    expect(serialize([])).toBe('');
  });

  it('кавычки в значении метки экранируются', () => {
    const text = serialize([
      {
        name: 'queues.received',
        kind: 'counter',
        attributes: { queue: 'say "hi"' },
        value: 1,
      },
    ]);

    expect(text).toContain(String.raw`queue="say \"hi\""`);
  });
});
