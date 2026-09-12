/**
 * Метрики ядра: интерфейс, DI-токены, kernel-модуль и имена метрик,
 * которые пишет само ядро.
 *
 * Пустая реализация наружу не идёт: приложение задаёт корень опцией
 * `makeApp({ metrics })`, а её отсутствие и означает умолчание.
 */

export type { MetricAttributes, Metrics } from './interface.js';
export { metricsKernel } from './kernel.js';
export { configuredMetrics, noopMetrics } from './noop.js';
export { KERNEL_METRICS } from './names.js';
export { Metrics$, RootMetrics$ } from './tokens.js';
