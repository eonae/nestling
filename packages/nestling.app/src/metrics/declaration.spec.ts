/**
 * Объявление группы: имена, проверки создания и форма писателя.
 */

import { counter, histogram, makeMetrics, open } from './declaration.js';

import { describe, expect, it } from 'vitest';

describe('makeMetrics — имена', () => {
  it('имя складывается из префикса и ключа', () => {
    const group = makeMetrics('orders', {
      created: counter(),
      'checkout.duration': histogram({ unit: 'ms', buckets: [10, 100] }),
    });

    expect(group.members.created.name).toBe('orders.created');
    expect(group.members['checkout.duration'].name).toBe(
      'orders.checkout.duration',
    );
  });

  it('группа несёт префикс и служит DI-токеном', () => {
    const group = makeMetrics('orders', { created: counter() });

    expect(group.prefix).toBe('orders');
    expect(group.id).toBe('Metrics:orders');
    expect(group.hint).toContain("'metrics:'");
  });
});

describe('makeMetrics — проверки создания', () => {
  it('пустой префикс не принимается', () => {
    expect(() => makeMetrics('  ', { created: counter() })).toThrow(
      /'prefix' must be a non-empty string/,
    );
  });

  it('группа без метрик не принимается', () => {
    expect(() => makeMetrics('orders', {})).toThrow(/declares no metrics/);
  });

  it('пустой ключ не принимается', () => {
    expect(() => makeMetrics('orders', { ' ': counter() })).toThrow(
      /a metric key is empty/,
    );
  });

  it('границы корзин идут по возрастанию', () => {
    expect(() =>
      makeMetrics('orders', {
        'checkout.duration': histogram({ buckets: [100, 10] }),
      }),
    ).toThrow(/'orders.checkout.duration' declares buckets out of order/);
  });

  it('гистограмма без корзин не принимается', () => {
    expect(() =>
      makeMetrics('orders', { latency: histogram({ buckets: [] }) }),
    ).toThrow(/'orders.latency' must declare bucket boundaries/);
  });

  it('атрибут объявляется перечнем или пометкой open', () => {
    expect(() =>
      makeMetrics('orders', {
        created: counter({ attributes: { tier: [] } }),
      }),
    ).toThrow(/attribute 'tier' of metric 'orders.created'/);
  });

  it('перечень не повторяет значение', () => {
    expect(() =>
      makeMetrics('orders', {
        created: counter({ attributes: { tier: ['free', 'free'] } }),
      }),
    ).toThrow(/lists a value twice/);
  });

  it('член группы обязан быть объявлением метрики', () => {
    expect(() =>
      makeMetrics('orders', {
        created: { kind: 'gauge' } as never,
      }),
    ).toThrow(/member 'created' is not a metric declaration/);
  });
});

describe('makeMetrics — объявление метрики', () => {
  it('счётчик несёт описание, единицу и атрибуты', () => {
    const group = makeMetrics('orders', {
      created: counter({
        help: 'Created orders',
        unit: 'orders',
        attributes: { tier: ['free', 'paid'], source: open },
      }),
    });

    expect(group.members.created).toMatchObject({
      kind: 'counter',
      help: 'Created orders',
      unit: 'orders',
      attributes: { tier: ['free', 'paid'], source: open },
    });
  });

  it('гистограмма несёт границы корзин', () => {
    const group = makeMetrics('orders', {
      latency: histogram({ unit: 'ms', buckets: [10, 100] }),
    });

    expect(group.members.latency).toMatchObject({
      kind: 'histogram',
      buckets: [10, 100],
    });
  });

  it('создание группы ничего не регистрирует', () => {
    const group = makeMetrics('orders', { created: counter() });

    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.members)).toBe(true);
  });
});
