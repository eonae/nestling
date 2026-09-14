import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  compose,
  Logger$,
  makePipeline,
  withRequestId,
  withTracing,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { otel } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Шаг `.finally`: пишет строку аудита по завершении каждого запроса.
 *
 * Это класс, потому что шагу нужен логгер из контейнера. Класс-шаг
 * регистрируется в `providers:` фичи, как любой другой провайдер.
 */
@Handler([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // Идентификатор запроса в запись кладёт логгер ядра: он читает его из
    // контекста сам, и руками префикс не пишется
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

/**
 * Куда уходят участки трассы.
 *
 * Развёртывание называет адрес коллектора переменной
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, и участки уходят ему по OTLP. Без адреса
 * они копятся в памяти: так их читает спека примера, а поведение
 * приложения от выбора экспортёра не меняется.
 */
export const traces: SpanExporter =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
    ? new InMemorySpanExporter()
    : new OTLPTraceExporter();

/**
 * Сателлит телеметрии: слой участков и плагин.
 *
 * Метрики отсюда не уходят: их отдаёт сборщику экспозиция
 * `@nestlingjs/prometheus`, подключённая в `app.ts`. Плагин сателлита всё
 * равно нужен — он закрывает экспортёр на остановке.
 */
export const telemetry = otel({
  service: 'microservice',
  version: '1.0.0',
  traces,
});

/**
 * Слой наблюдаемости: кладёт `requestId` и трассу в контекст, пишет
 * участок трассы и аудит.
 *
 * Трасса продолжает ту, что пришла заголовком `traceparent`, или начинает
 * новую. Идентификатор трассы в записи логгера ставит ядро: поле `traceId`
 * появляется у каждой записи внутри запроса. Участок с интервалом и
 * исходом собирает слой сателлита: своего шага отправки в примере нет.
 *
 * Слой — значение. Endpoint подключает его через `pipeline:`, а политика
 * в `app.ts` проверяет по ссылке, что слой есть у каждого endpoint'а.
 */
export const traced = compose(
  makePipeline().pre(withRequestId()).pre(withTracing()).finally(AuditOutcome),
  telemetry.spans,
);
