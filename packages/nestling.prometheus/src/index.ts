/**
 * `@nestlingjs/prometheus` — экспозиция метрик в формате Prometheus.
 *
 * Пакет даёт один плагин: endpoint `/metrics` читает `MetricsStore$` ядра
 * и сериализует его снимок. Накопления у пакета своего нет, зависимостей
 * от OpenTelemetry — тоже: это один формат экспозиции, а не модель
 * телеметрии.
 *
 * Барель перечисляет имена поимённо: пакет обещает ровно их.
 */

// ./plugin.js — 2
export { makePrometheus } from './plugin.js';
export type { PrometheusOptions } from './plugin.js';

// ./serialize.js — 1
export { serialize } from './serialize.js';
