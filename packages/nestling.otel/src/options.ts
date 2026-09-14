/**
 * Опции сателлита и его значение: один вход, две части.
 *
 * `service` и `version` нужны обеим частям — атрибуты ресурса у трасс и у
 * метрик одни и те же, поэтому имя сервиса пишется один раз.
 */

import type { OtelSpan } from './span.js';

import type { Pipeline, Plugin, TraceContext } from '@nestlingjs/app';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Внешний контекст слоя участков: трасса запроса.
 *
 * Алиас, а не интерфейс: параметр `Pipeline` требует совместимости с
 * `AnyInput`, а у интерфейса нет неявной индексной сигнатуры.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SpanRequirements = {
  trace: TraceContext;
};

/** Накопленный контекст слоя участков: трасса и участок */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SpanContext = {
  trace: TraceContext;
  span: OtelSpan;
};

/**
 * Слой участков: требует трассу во внешнем контексте, добавляет участок.
 *
 * Композиция без `withTracing()` выше не компилируется: требование к
 * контексту проверяет компилятор, как у любого другого слоя.
 */
export type SpansLayer = Pipeline<SpanRequirements, SpanContext>;

/** Опции сателлита */
export interface OtelOptions {
  /** Имя сервиса: атрибут ресурса `service.name` */
  readonly service: string;

  /** Версия сервиса: атрибут ресурса `service.version` */
  readonly version?: string;

  /** Куда уходят участки; без него слой не отправляет ничего */
  readonly traces?: SpanExporter;

  /** Куда уходят метрики; без него подписки на store не возникает */
  readonly metrics?: PushMetricExporter;

  /** Интервал отправки метрик, мс; умолчание — 60000 */
  readonly intervalMs?: number;
}

/** Сателлит: слой участков и плагин push'а метрик */
export interface Otel {
  /** Слой участков: композируется в слой наблюдаемости приложения */
  readonly spans: SpansLayer;

  /** Плагин: ресурс отправки метрик и сброса на остановке */
  readonly plugin: Plugin;
}

/** Интервал отправки метрик по умолчанию, мс */
export const DEFAULT_INTERVAL_MS = 60_000;

/** Имя области инструментовки: сателлит, собравший участок или точку */
export const SCOPE_NAME = '@nestlingjs/otel';
