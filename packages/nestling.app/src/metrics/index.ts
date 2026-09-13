/**
 * Метрики: объявление группой, каталог сборки и store ядра.
 *
 * Метрика — декларация-значение, а не строка в точке записи: состав
 * известен сборке целиком, поэтому экспозиция отдаёт нули до первой
 * записи, а незадекларированная запись невыразима в типах.
 */

export type {
  CatalogMetric,
  MetricsCatalog,
  MetricsContribution,
  SeriesResolutions,
} from './catalog.js';
export { makeCatalog, seriesIndex, seriesKey } from './catalog.js';
export type {
  AnyMember,
  AnyMetricsGroup,
  AttributesOf,
  AttributesSpec,
  AttributeSpec,
  CounterDeclaration,
  CounterWriter,
  HistogramDeclaration,
  HistogramOptions,
  HistogramWriter,
  Member,
  MembersOf,
  MetricDeclaration,
  MetricOptions,
  MetricsGroup,
  MetricsMembers,
  MetricsOf,
  MetricsWriter,
  Open,
} from './declaration.js';
export {
  counter,
  histogram,
  isMetricsGroup,
  makeMetrics,
  metricName,
  open,
} from './declaration.js';
export type {
  CallAttributes,
  KernelMetricsWriter,
  MetricEndpoint,
  MetricOperation,
  RequestAttributes,
} from './kernel-group.js';
export { KernelMetrics, kernelSeries } from './kernel-group.js';
export { metricsKernel } from './kernel.js';
export { findSeries, findSeriesOne } from './lookup.js';
export { defaultMetrics } from './standalone.js';
export type {
  CounterSeries,
  HistogramBucket,
  HistogramSeries,
  MetricAttributes,
  MetricSeries,
  MetricSink,
  MetricsSnapshot,
} from './sink.js';
export { MetricsStore, MetricsStore$ } from './store.js';
export { makeWriter } from './writer.js';
