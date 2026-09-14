/**
 * Писатель группы: значение, которое граф раздаёт по группе-DI-токену.
 *
 * Метрика выбирается полем, а не строкой, поэтому незадекларированная
 * запись невыразима. Адрес ряда вычислен на сборке: запись объявленного
 * ряда — прибавка по индексу.
 */

import type { CatalogMetric } from './catalog.js';
import { seriesIndex } from './catalog.js';
import type { AnyMetricsGroup, MetricsOf } from './declaration.js';
import type { MetricAttributes } from './snapshot.js';
import type { MetricsStore } from './store.js';

/** Атрибуты без записи: у метрики, которая их не объявляла */
const NO_ATTRIBUTES: MetricAttributes = Object.freeze({});

/** Писатель одной метрики: счётчик или гистограмма */
function memberWriter(
  metric: CatalogMetric,
  store: MetricsStore,
): CounterMember | HistogramMember {
  if (metric.kind === 'counter') {
    return {
      add: (first?: number | MetricAttributes, second?: MetricAttributes) => {
        // Прибавка необязательна, поэтому первым аргументом приходит либо
        // она, либо сразу атрибуты: у записи одна форма на обе.
        const attributes =
          typeof first === 'object' ? first : (second ?? NO_ATTRIBUTES);
        const value = typeof first === 'number' ? first : 1;

        store.add(metric, seriesIndex(metric, attributes), value, attributes);
      },
    };
  }

  return {
    record: (value: number, attributes: MetricAttributes = NO_ATTRIBUTES) => {
      store.observe(metric, seriesIndex(metric, attributes), value, attributes);
    },
  };
}

/** Писатель счётчика в рантайме: типы даёт `CounterWriter` */
interface CounterMember {
  add(first?: number | MetricAttributes, second?: MetricAttributes): void;
}

/** Писатель гистограммы в рантайме: типы даёт `HistogramWriter` */
interface HistogramMember {
  record(value: number, attributes?: MetricAttributes): void;
}

/**
 * Собирает писателя группы по каталогу store.
 *
 * @param group - Подключённая группа метрик
 * @param store - Store приложения
 * @returns Писателя: метрика выбирается полем по ключу группы
 *
 * @throws {Error} Группы нет в каталоге сборки
 */
export function makeWriter<G extends AnyMetricsGroup>(
  group: G,
  store: MetricsStore,
): MetricsOf<G> {
  const members = store.catalog.members(group);

  if (members.size === 0) {
    throw new Error(
      `Metrics group '${group.id}' is not in the build catalog. Contribute ` +
        `it with 'metrics: [<group>]' of the feature, module or plugin that ` +
        `writes it.`,
    );
  }

  const writer: Record<string, CounterMember | HistogramMember> = {};

  for (const [key, metric] of members) {
    writer[key] = memberWriter(metric, store);
  }

  return Object.freeze(writer) as MetricsOf<G>;
}
