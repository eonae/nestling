/**
 * Участок трассы: открытие, обогащение и закрытие исходом.
 *
 * Идентификаторы берутся из переменной `Trace` ядра, поэтому участки
 * соседних процессов сходятся в одно дерево. Значение закрытого участка —
 * формы `ReadableSpan`, той же, которую `SpanExporter` получает от SDK:
 * готовый экспортёр работает без переходника.
 */

import { now, since } from './clock.js';
import { SCOPE_NAME } from './options.js';
import type { OtelSpan } from './span.js';

import type { EndpointMeta, Outcome, TraceContext } from '@nestlingjs/app';
import type {
  Attributes,
  AttributeValue,
  HrTime,
  SpanStatus,
} from '@opentelemetry/api';
import { SpanKind, SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base';

/**
 * Статус участка по исходу шага.
 *
 * `disconnected` остаётся `UNSET`: уход клиента не отказ сервиса, и доля
 * ошибок в дашборде не растёт от поведения клиентов. Сам исход остаётся
 * атрибутом участка, поэтому отбор по нему возможен.
 */
const STATUS: Record<Outcome, SpanStatusCode> = {
  completed: SpanStatusCode.OK,
  failed: SpanStatusCode.ERROR,
  aborted: SpanStatusCode.ERROR,
  disconnected: SpanStatusCode.UNSET,
};

/** Область инструментовки участков: имя пакета */
const SCOPE = { name: SCOPE_NAME };

/**
 * Открытый участок: копит атрибуты и события, пока идёт запрос.
 *
 * Значение кладёт в контекст pre-шаг слоя, закрывает `.finally`-шаг того
 * же слоя. Прикладной код видит его через `Ctx(Span)` как {@link OtelSpan}
 * — два метода, без закрытия.
 */
export class OpenSpan implements OtelSpan {
  /** Трасса запроса: идентификаторы участка и его родителя */
  readonly #trace: TraceContext;

  /** Endpoint запроса: имя участка и его атрибуты */
  readonly #endpoint: EndpointMeta;

  /** Отметка открытия */
  readonly #start: HrTime = now();

  /** Атрибуты, дописанные приложением */
  readonly #attributes: Attributes = {};

  /** События, дописанные приложением */
  readonly #events: TimedEvent[] = [];

  /**
   * @param trace - Трасса запроса из переменной `Trace`
   * @param endpoint - Метаданные endpoint'а
   */
  constructor(trace: TraceContext, endpoint: EndpointMeta) {
    this.#trace = trace;
    this.#endpoint = endpoint;
  }

  /**
   * Ставит атрибут на участке.
   *
   * @param key - Имя атрибута
   * @param value - Значение атрибута
   */
  setAttribute(key: string, value: AttributeValue): void {
    this.#attributes[key] = value;
  }

  /**
   * Добавляет событие с отметкой времени вызова.
   *
   * @param name - Имя события
   * @param attributes - Атрибуты события
   */
  addEvent(name: string, attributes?: Attributes): void {
    this.#events.push({
      name,
      time: now(),
      ...(attributes === undefined ? {} : { attributes }),
    });
  }

  /**
   * Закрывает участок исходом запроса.
   *
   * @param outcome - Исход, с которым `.finally`-шаг видит запрос
   * @param resource - Атрибуты ресурса сателлита
   * @returns Закрытый участок формы `ReadableSpan`
   */
  close(outcome: Outcome, resource: Resource): ReadableSpan {
    const end = now();
    const flags = this.#trace.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE;
    const status: SpanStatus = { code: STATUS[outcome] };

    const spanContext = {
      traceId: this.#trace.traceId,
      spanId: this.#trace.spanId,
      traceFlags: flags,
    };

    return {
      name: this.#endpoint.pattern,
      kind: SpanKind.SERVER,
      spanContext: () => spanContext,
      ...(this.#trace.parentSpanId === undefined
        ? {}
        : {
            parentSpanContext: {
              traceId: this.#trace.traceId,
              spanId: this.#trace.parentSpanId,
              traceFlags: flags,
            },
          }),
      startTime: this.#start,
      endTime: end,
      duration: since(this.#start, end),
      status,
      attributes: {
        transport: this.#endpoint.transport,
        pattern: this.#endpoint.pattern,
        outcome,
        ...this.#attributes,
      },
      links: [],
      events: this.#events,
      ended: true,
      resource,
      instrumentationScope: SCOPE,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };
  }
}
