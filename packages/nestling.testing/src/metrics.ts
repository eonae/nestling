/**
 * `spyMetrics()` — метрики, которые копят записи значениями.
 *
 * Подмена `[RootMetrics$, spy.metrics]` в `overrides` перехватывает записи
 * всех DI-токенов `Metrics$` — и ядра, и приложения: рецепт семейства
 * оборачивает корень, добавляя атрибут `scope`. Она же включает
 * инструментовку ядра, потому что под корнем оказывается не пустая
 * реализация.
 */

import type { MetricAttributes, Metrics } from '@nestlingjs/app';

/** Одна запись метрик-шпиона */
export interface MetricRecord {
  /** Вид метрики */
  readonly kind: 'counter' | 'histogram';

  /** Имя метрики */
  readonly name: string;

  /** Значение; у счётчика без прибавки — единица */
  readonly value: number;

  /** Атрибуты записи, включая `scope` токена семейства */
  readonly attributes: MetricAttributes;
}

/** Метрики-шпион и их записи */
export interface SpyMetrics {
  /** Реализация для подмены `RootMetrics$` или передачи в код напрямую */
  readonly metrics: Metrics;

  /** Записи в порядке вызовов, включая записи токенов семейства */
  readonly records: readonly MetricRecord[];
}

/**
 * Создаёт метрики-шпион.
 *
 * @returns Реализация и список её записей
 *
 * @example
 * ```typescript
 * const spy = spyMetrics();
 * await using testApp = await buildTest(app, {
 *   overrides: [[RootMetrics$, spy.metrics]],
 * });
 *
 * await testApp.call(CreateUser, { name: 'Alice' });
 *
 * expect(spy.records).toContainEqual({
 *   kind: 'counter',
 *   name: 'created',
 *   value: 1,
 *   attributes: { scope: 'UsersService' },
 * });
 * ```
 */
export function spyMetrics(): SpyMetrics {
  const records: MetricRecord[] = [];

  const metrics: Metrics = {
    counter: (name: string, value = 1, attributes: MetricAttributes = {}) => {
      records.push({ kind: 'counter', name, value, attributes });
    },

    histogram: (
      name: string,
      value: number,
      attributes: MetricAttributes = {},
    ) => {
      records.push({ kind: 'histogram', name, value, attributes });
    },
  };

  return { metrics, records };
}
