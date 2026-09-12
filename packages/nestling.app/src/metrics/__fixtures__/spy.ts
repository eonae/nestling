/**
 * Метрики-шпион для спек пакета: копят записи значениями.
 *
 * Тот же контракт, что у `spyMetrics()` из `@nestlingjs/testing`; свой
 * экземпляр здесь потому, что `@nestlingjs/testing` зависит от этого
 * пакета, а не наоборот.
 */

import type { MetricAttributes, Metrics } from '../interface.js';

/** Одна запись шпиона */
export interface SpyRecord {
  readonly kind: 'counter' | 'histogram';
  readonly name: string;
  readonly value: number;
  readonly attributes: MetricAttributes;
}

/** Метрики-шпион и их записи */
export interface SpyMetrics {
  readonly metrics: Metrics;
  readonly records: readonly SpyRecord[];
}

/** Создаёт метрики-шпион: записи всех членов семейства идут в один список */
export function spyMetrics(): SpyMetrics {
  const records: SpyRecord[] = [];

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

/** Записи с заданным именем */
export const recordsNamed = (
  spy: SpyMetrics,
  name: string,
): readonly SpyRecord[] => spy.records.filter((record) => record.name === name);
