import type { EmptyInput, TraceContext } from '../core/index.js';
import {
  ambientTrace,
  formatTraceparent,
  newSpanId,
  newTraceId,
  parsePropagatedTrace,
  parseTraceparent,
  Trace,
} from '../core/index.js';
import type { PreStepFn } from '../core/types/index.js';

/**
 * Родительская трасса из транспортных атрибутов.
 *
 * Порядок источников — от точного к общему: значение, привезённое шиной,
 * уже является трассой, а заголовок HTTP её только кодирует.
 */
function parentOf(
  attributes: Record<string, unknown>,
): TraceContext | undefined {
  return (
    parsePropagatedTrace(attributes[Trace.key]) ??
    parseTraceparent(attributes.traceparent)
  );
}

/**
 * Добавляет трассу в контекст запроса.
 *
 * Продолжает трассу вызывающего, если она пришла: полем `trace` конверта
 * шины или заголовком `traceparent` по HTTP. Иначе начинает новую.
 * Идентификатор участка создаётся на каждый запрос, прежний участок
 * уходит в `parentSpanId`.
 *
 * Непонятное значение не отказ: оно приходит из-за границы доверия и
 * схемы не имеет, поэтому игнорируется, а трасса начинается заново.
 *
 * Писатель — сама переменная {@link Trace}: слой, композированный от
 * этого шага, удовлетворяет политике `everyEndpoint(…).hasVar(Trace)`, а
 * глубокий сервис читает значение через `Ctx(Trace)`.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestId())
 *   .pre(withTracing());
 * ```
 */
export function withTracing(): PreStepFn<EmptyInput, { trace: TraceContext }> {
  return Trace.provide((ctx) => {
    const parent = parentOf(ctx.raw.attributes);

    return {
      traceId: parent?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
      sampled: parent?.sampled ?? true,
    };
  });
}

/**
 * Трасса текущего запроса строкой W3C или `undefined`, если её нет.
 *
 * Значение для заголовка `traceparent` исходящего запроса: идентификатор
 * участка берётся собственный, и получатель становится его ребёнком.
 *
 * Читалка отдаётся значением, потому что её потребитель живёт в другом
 * пакете: типизированный HTTP-клиент зависит только от
 * `@nestlingjs/operations` и собирается для браузера, поэтому ambient-
 * контекст ему недоступен. Клиент принимает эту функцию опцией `trace`.
 *
 * @example
 * ```typescript
 * const api = makeClient(
 *   { getUser: GetUser },
 *   { baseUrl, trace: traceparent },
 * );
 * ```
 */
export function traceparent(): string | undefined {
  const trace = ambientTrace();

  return trace === undefined ? undefined : formatTraceparent(trace);
}
