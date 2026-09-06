import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestling/app';
import { Logger$, makePipeline, withRequestId } from '@nestling/app';
import { Handler } from '@nestling/container';

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
 * Слой наблюдаемости: кладёт `requestId` в контекст и пишет аудит.
 *
 * Слой — значение. Endpoint подключает его через `pipeline:`, а политика
 * в `app.ts` проверяет по ссылке, что слой есть у каждого endpoint'а.
 */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
