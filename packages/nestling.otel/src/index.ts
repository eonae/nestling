/**
 * `@nestlingjs/otel` — экспорт телеметрии по OpenTelemetry.
 *
 * Пакет даёт один вход `otel(options)` и две части: слой участков трассы
 * и плагин отправки метрик по OTLP. Накопления у пакета своего нет —
 * участок собирается из переменной `Trace` ядра, а точки метрик из
 * снимка `MetricsStore$`.
 *
 * Экспортёров пакет не оборачивает: `SpanExporter` и `PushMetricExporter`
 * приходят опциями готовыми значениями, поэтому выбор протокола остаётся
 * за приложением.
 *
 * Барель перечисляет имена поимённо: пакет обещает ровно их.
 */

// ./otel.js — 1
export { otel } from './otel.js';

// ./options.js — 2
export type { Otel, OtelOptions } from './options.js';

// ./span.js — 2
export { Span } from './span.js';
export type { OtelSpan } from './span.js';
