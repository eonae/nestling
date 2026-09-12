import type { EmptyInput, TraceContext } from '../core/index.js';
import {
  newSpanId,
  newTraceId,
  parsePropagatedTrace,
  parseTraceparent,
  Trace,
} from '../core/index.js';
import type { PreUnitFn } from '../core/types/index.js';

/**
 * Родительская трасса из транспортных атрибутов.
 *
 * Порядок источников — от точного к общему: значение, привезённое шиной,
 * уже является трассой, а заголовок HTTP её только кодирует.
 */
function parentOf(attributes: Record<string, unknown>): TraceContext | undefined {
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
 * этого юнита, удовлетворяет политике `everyEndpoint(…).hasVar(Trace)`, а
 * глубокий сервис читает значение через `Ctx(Trace)`.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestId())
 *   .pre(withTracing());
 * ```
 */
export function withTracing(): PreUnitFn<EmptyInput, { trace: TraceContext }> {
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
