import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  Logger$,
  makePipeline,
  withRequestId,
  withTracing,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * Юнит `.finally`: пишет строку аудита по завершении каждого запроса.
 *
 * Это класс, потому что юниту нужен логгер из контейнера. Класс-юнит
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
 * Слой наблюдаемости: кладёт `requestId` и трассу в контекст и пишет
 * аудит.
 *
 * Трасса продолжает ту, что пришла заголовком `traceparent`, или начинает
 * новую. Идентификатор трассы в записи логгера ставит ядро: поле `traceId`
 * появляется у каждой записи внутри запроса.
 *
 * Слой — значение. Endpoint подключает его через `pipeline:`, а политика
 * в `app.ts` проверяет по ссылке, что слой есть у каждого endpoint'а.
 */
export const observability = makePipeline()
  .pre(withRequestId())
  .pre(withTracing())
  .finally(AuditOutcome);
