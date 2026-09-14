/**
 * Store метрик: накопленное держит ядро.
 *
 * Store есть у любого приложения и накапливает записи независимо от того,
 * читает ли их кто-нибудь. Выход один: `snapshot()` отдаёт состояние
 * рядов на момент вызова. Формата экспорта store не знает.
 */

import type { CatalogMetric, MetricsCatalog } from './catalog.js';
import { seriesKey } from './catalog.js';
import type {
  HistogramBucket,
  MetricAttributes,
  MetricSeries,
  MetricsSnapshot,
} from './snapshot.js';

import type { Token } from '@nestlingjs/container';
import { makeToken } from '@nestlingjs/container';

/** Агрегат гистограммы одного ряда: наблюдения по корзинам декларации */
interface HistogramCell {
  /** Число наблюдений */
  count: number;

  /** Сумма наблюдённых значений */
  sum: number;

  /**
   * Наблюдения по корзинам: на одну больше, чем границ.
   *
   * Последняя ячейка — наблюдения выше последней границы: в экспозиции
   * это `+Inf`, и без неё сумма корзин расходилась бы со счётчиком.
   */
  readonly buckets: Float64Array;
}

/** Ряд, заведённый по факту записи: атрибуты и накопленное */
interface OpenSeries {
  /** Атрибуты ряда — те, с которыми пришла первая запись */
  readonly attributes: MetricAttributes;

  /** Накопленное значение счётчика */
  value: number;

  /** Агрегат гистограммы */
  readonly cell?: HistogramCell;
}

/** Пустой агрегат гистограммы по числу границ */
const emptyCell = (boundaries: number): HistogramCell => ({
  count: 0,
  sum: 0,
  buckets: new Float64Array(boundaries + 1),
});

/** Номер корзины наблюдения: первая граница, которую оно не превышает */
function bucketOf(buckets: readonly number[], value: number): number {
  for (const [index, boundary] of buckets.entries()) {
    if (value <= boundary) {
      return index;
    }
  }

  return buckets.length;
}

/** Кумулятивные корзины снимка: `le` и наблюдения не больше границы */
function cumulative(
  boundaries: readonly number[],
  cell: HistogramCell | undefined,
): readonly HistogramBucket[] {
  const buckets: HistogramBucket[] = [];
  let running = 0;

  for (const [index, le] of boundaries.entries()) {
    running += cell?.buckets[index] ?? 0;
    buckets.push({ le, count: running });
  }

  return buckets;
}

/** Ряд снимка: счётчик значением, гистограмма агрегатом */
function seriesOf(
  metric: CatalogMetric,
  attributes: MetricAttributes,
  value: number,
  cell: HistogramCell | undefined,
): MetricSeries {
  const described = {
    name: metric.name,
    attributes,
    ...(metric.help !== undefined && { help: metric.help }),
    ...(metric.unit !== undefined && { unit: metric.unit }),
  };

  if (metric.kind === 'counter') {
    return { ...described, kind: 'counter', value };
  }

  return {
    ...described,
    kind: 'histogram',
    count: cell?.count ?? 0,
    sum: cell?.sum ?? 0,
    buckets: cumulative(metric.buckets ?? [], cell),
  };
}

/**
 * Накопленные метрики приложения.
 *
 * Ряды с объявленными атрибутами лежат в плоском хранилище и адресуются
 * индексом, вычисленным на сборке: запись такого ряда не собирает
 * строкового ключа. Ряды открытых атрибутов заводятся по факту записи и
 * живут в словаре.
 */
export class MetricsStore {
  /** Каталог, по которому заведены ряды */
  readonly catalog: MetricsCatalog;

  /** Значения счётчиков по индексам каталога */
  readonly #counters: Float64Array;

  /** Агрегаты гистограмм по индексам каталога; создаются первой записью */
  readonly #histograms: (HistogramCell | undefined)[];

  /** Ряды открытых атрибутов: метрика — её ряды по ключу */
  readonly #open = new Map<CatalogMetric, Map<string, OpenSeries>>();

  /**
   * @param catalog - Каталог метрик сборки
   */
  constructor(catalog: MetricsCatalog) {
    this.catalog = catalog;
    this.#counters = new Float64Array(catalog.counters);
    this.#histograms = Array.from<HistogramCell | undefined>({
      length: catalog.histograms,
    });
  }

  /**
   * Состояние всех заведённых рядов на момент вызова.
   *
   * Снимок — копия: записи, прошедшие после вызова, его не меняют.
   *
   * @returns Ряды со значениями и каталожными полями метрик
   */
  snapshot(): MetricsSnapshot {
    const snapshot: MetricSeries[] = [];

    for (const metric of this.catalog.metrics) {
      for (const [offset, attributes] of metric.series.entries()) {
        const at = metric.base + offset;

        snapshot.push(
          seriesOf(
            metric,
            attributes,
            metric.kind === 'counter' ? (this.#counters[at] as number) : 0,
            metric.kind === 'counter' ? undefined : this.#histograms[at],
          ),
        );
      }

      for (const series of this.#open.get(metric)?.values() ?? []) {
        snapshot.push(
          seriesOf(metric, series.attributes, series.value, series.cell),
        );
      }
    }

    return snapshot;
  }

  /**
   * Прибавляет к счётчику.
   *
   * @param metric - Метрика каталога
   * @param index - Индекс ряда или `undefined` у открытого ряда
   * @param value - Прибавка
   * @param attributes - Атрибуты записи
   *
   * @internal Пишут писатели групп, а не приложение
   */
  add(
    metric: CatalogMetric,
    index: number | undefined,
    value: number,
    attributes: MetricAttributes,
  ): void {
    if (index === undefined) {
      this.#openSeries(metric, attributes).value += value;
    } else {
      this.#counters[index] = (this.#counters[index] as number) + value;
    }
  }

  /**
   * Добавляет наблюдение в гистограмму.
   *
   * @param metric - Метрика каталога
   * @param index - Индекс ряда или `undefined` у открытого ряда
   * @param value - Наблюдённое значение
   * @param attributes - Атрибуты записи
   *
   * @internal Пишут писатели групп, а не приложение
   */
  observe(
    metric: CatalogMetric,
    index: number | undefined,
    value: number,
    attributes: MetricAttributes,
  ): void {
    const boundaries = metric.buckets ?? [];
    const cell =
      index === undefined
        ? (this.#openSeries(metric, attributes).cell as HistogramCell)
        : (this.#histograms[index] ??= emptyCell(boundaries.length));

    cell.count += 1;
    cell.sum += value;

    const bucket = bucketOf(boundaries, value);
    cell.buckets[bucket] = (cell.buckets[bucket] as number) + 1;
  }

  /** Ряд открытых атрибутов: заводится первой записью */
  #openSeries(metric: CatalogMetric, attributes: MetricAttributes): OpenSeries {
    let rows = this.#open.get(metric);

    if (!rows) {
      rows = new Map();
      this.#open.set(metric, rows);
    }

    const key = seriesKey(metric, attributes);
    let series = rows.get(key);

    if (!series) {
      series = {
        attributes: { ...attributes },
        value: 0,
        ...(metric.kind === 'histogram' && {
          cell: emptyCell((metric.buckets ?? []).length),
        }),
      };
      rows.set(key, series);
    }

    return series;
  }
}

/**
 * Накопленные метрики приложения.
 *
 * Узел есть в графе всегда, без опций и условий. Провайдер приложения под
 * ним — ошибка дубля: store принадлежит ядру, и второго не бывает.
 */
export const MetricsStore$: Token<MetricsStore> =
  makeToken<MetricsStore>('MetricsStore');
