/**
 * Точки OTLP из снимка store: перевод, а не подсчёт.
 *
 * Значения уже накоплены ядром, корзины посчитаны по границам декларации,
 * а `help` и `unit` пришли из каталога. Работа перевода — разложить ряд
 * снимка по полям, которые ждёт `PushMetricExporter`.
 *
 * Временна́я привязка кумулятивная: store копит от старта процесса, и
 * дельту считает бэкенд. Это же умолчание у экспозиции Prometheus,
 * поэтому две картины одного приложения совпадают.
 */

import { SCOPE_NAME } from './options.js';

import type {
  HistogramSeries,
  MetricSeries,
  MetricsSnapshot,
} from '@nestlingjs/app';
import type { HrTime } from '@opentelemetry/api';
import { ValueType } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type {
  DataPoint,
  Histogram,
  MetricData,
  MetricDescriptor,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  AggregationTemporality,
  DataPointType,
} from '@opentelemetry/sdk-metrics';

/** Область инструментовки точек: имя пакета */
const SCOPE = { name: SCOPE_NAME };

/** Описание метрики: имя, описание и единица из ряда снимка */
function descriptorOf(series: MetricSeries): MetricDescriptor {
  return {
    name: series.name,
    description: series.help ?? '',
    unit: series.unit ?? '',
    valueType: ValueType.DOUBLE,
  };
}

/**
 * Наблюдения по корзинам: снимок даёт накопленные, OTLP ждёт раздельные.
 *
 * Последняя ячейка — наблюдения выше последней границы: их число равно
 * разности счётчика ряда и накопленного в последней корзине.
 *
 * @param series - Ряд гистограммы из снимка
 * @returns Границы и число наблюдений в каждой корзине
 */
function bucketsOf(series: HistogramSeries): Histogram['buckets'] {
  const boundaries: number[] = [];
  const counts: number[] = [];
  let below = 0;

  for (const { le, count } of series.buckets) {
    boundaries.push(le);
    counts.push(count - below);
    below = count;
  }

  counts.push(series.count - below);

  return { boundaries, counts };
}

/** Точка ряда: атрибуты и значение на момент снятия */
function pointOf<T>(
  series: MetricSeries,
  value: T,
  startTime: HrTime,
  endTime: HrTime,
): DataPoint<T> {
  return { startTime, endTime, attributes: series.attributes, value };
}

/** Метрика OTLP из рядов одного имени */
function metricOf(
  series: readonly MetricSeries[],
  startTime: HrTime,
  endTime: HrTime,
): MetricData {
  const [first] = series as [MetricSeries];
  const descriptor = descriptorOf(first);

  if (first.kind === 'counter') {
    return {
      descriptor,
      aggregationTemporality: AggregationTemporality.CUMULATIVE,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints: series.map((row) =>
        pointOf(
          row,
          row.kind === 'counter' ? row.value : 0,
          startTime,
          endTime,
        ),
      ),
    };
  }

  return {
    descriptor,
    aggregationTemporality: AggregationTemporality.CUMULATIVE,
    dataPointType: DataPointType.HISTOGRAM,
    dataPoints: (series as readonly HistogramSeries[]).map((row) =>
      pointOf<Histogram>(
        row,
        { buckets: bucketsOf(row), count: row.count, sum: row.sum },
        startTime,
        endTime,
      ),
    ),
  };
}

/**
 * Переводит снимок store в точки OTLP.
 *
 * Ряды одной метрики идут в снимке подряд — их порядок задаёт каталог,
 * поэтому метрика собирается одним проходом.
 *
 * @param snapshot - Снимок store
 * @param resource - Атрибуты ресурса сателлита
 * @param startTime - Начало накопления: старт процесса
 * @param endTime - Момент снятия
 * @returns Значение формы `ResourceMetrics`
 */
export function pointsOf(
  snapshot: MetricsSnapshot,
  resource: Resource,
  startTime: HrTime,
  endTime: HrTime,
): ResourceMetrics {
  const metrics: MetricData[] = [];
  let rows: MetricSeries[] = [];

  for (const series of snapshot) {
    if (rows.length > 0 && (rows[0] as MetricSeries).name !== series.name) {
      metrics.push(metricOf(rows, startTime, endTime));
      rows = [];
    }

    rows.push(series);
  }

  if (rows.length > 0) {
    metrics.push(metricOf(rows, startTime, endTime));
  }

  return { resource, scopeMetrics: [{ scope: SCOPE, metrics }] };
}
