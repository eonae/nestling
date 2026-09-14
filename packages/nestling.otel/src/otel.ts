/**
 * Вход сателлита: одно значение с двумя частями.
 *
 * Обе части — читатели того, что уже держит ядро: слой берёт
 * идентификаторы участка из переменной `Trace`, плагин берёт значения
 * метрик из `MetricsStore$`.
 */

import { makeSpans } from './layer.js';
import type { Otel, OtelOptions } from './options.js';
import { makePush } from './push.js';
import { serviceResource } from './resource.js';

/**
 * Собирает сателлит экспорта телеметрии.
 *
 * Слой композируется в слой наблюдаемости приложения, плагин уходит в
 * `plugins:` корня. Каждая часть работает отдельно: трассы без метрик и
 * метрики без трасс — рабочие сочетания.
 *
 * @param options - Имя сервиса, экспортёры и интервал отправки
 * @returns Слой участков и плагин
 *
 * @example
 * ```typescript
 * export const telemetry = otel({
 *   service: 'users',
 *   traces: new OTLPTraceExporter(),
 *   metrics: new OTLPMetricExporter(),
 * });
 *
 * export const observability = compose(
 *   makePipeline().pre(withRequestId()).pre(withTracing()),
 *   telemetry.spans,
 * );
 *
 * export const app = makeApp({
 *   features: [Users],
 *   plugins: [telemetry.plugin],
 *   policies: [everyEndpoint().hasVar(Span, 'span')],
 * });
 * ```
 */
export function otel(options: OtelOptions): Otel {
  const target = serviceResource(options);

  return {
    spans: makeSpans(target, options.traces),
    plugin: makePush(options, target),
  };
}
