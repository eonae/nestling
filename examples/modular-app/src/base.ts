/**
 * Базовый слой развёртывания: трасса, арендатор и участок трассы.
 *
 * Первые два значения приходят из-за границы процесса — трасса конвертом
 * сообщения, арендатор конвертом же. Слой возвращает их в контекст
 * запроса, и дальше их читает код любой глубины: `Ctx(TenantId)` —
 * прикладной, поле `traceId` записи — логгер ядра. Участок с интервалом и
 * исходом пишет слой сателлита: своего шага отправки в примере нет.
 *
 * Слой один на обе фичи. Именно поэтому записи процессов `users` и
 * `notifications` сходятся по одному `traceId`: обе стороны продолжают
 * трассу одним и тем же шагом. По той же причине участки двух процессов
 * складываются в одно дерево.
 */

import { TenantId } from './context.js';

import type { EmptyInput, Pipeline, TraceContext } from '@nestlingjs/app';
import { compose, makePipeline, withTracing } from '@nestlingjs/app';
import type { OtelSpan } from '@nestlingjs/otel';
import { otel } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Куда уходят участки трассы.
 *
 * Развёртывание называет адрес коллектора переменной
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, и участки уходят ему по OTLP. Без адреса
 * они копятся в памяти: так их читает спека примера, а поведение
 * приложения от выбора экспортёра не меняется.
 */
export const traces: SpanExporter =
  // eslint-disable-next-line @nestlingjs/no-process-globals -- сателлит телеметрии вне контейнера: экспортёр выбирается до сборки
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
    ? new InMemorySpanExporter()
    : new OTLPTraceExporter();

/**
 * Сателлит телеметрии: слой участков и плагин.
 *
 * Значение одно на оба процесса: декларация приложения одна, и процессы
 * различаются только выбором фич.
 */
export const telemetry = otel({ service: 'modular-app', traces });

/**
 * Что слой кладёт в контекст: трасса запроса, арендатор и участок.
 *
 * Тип написан явно, а не выведен: без аннотации TypeScript печатает
 * внутренний путь пакета и отказывается называть тип экспортируемого
 * значения. Алиас, а не интерфейс: параметр `Pipeline` требует
 * совместимости с `AnyInput`, а у интерфейса нет неявной индексной
 * сигнатуры.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type BaseContext = {
  trace: TraceContext;
  tenantId: string;
  span: OtelSpan;
};

export const traced: Pipeline<EmptyInput, BaseContext> = compose(
  makePipeline().pre(withTracing()).pre(TenantId.propagated()),
  telemetry.spans,
);
