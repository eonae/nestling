import type { Logger } from './logger.js';
import { Logger$ } from './logger.js';

import { Injectable } from '@nestling/container';
import type {
  ExtendableContext,
  Outcome,
  ResponseContext,
} from '@nestling/pipeline';
import { makePipeline, withRequestId } from '@nestling/pipeline';

/**
 * Юнит `.finally`: пишет строку аудита по завершении каждого запроса.
 *
 * Класс, потому что юниту нужен логгер из контейнера. Регистрируется в
 * `providers:` плагина.
 */
@Injectable([Logger$])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // В ответной фазе поля своего слоя опциональны: pre-юнит мог не
    // выполниться, отсюда `?? 'n/a'`
    this.logger.log(
      `[${ctx.input.requestId ?? 'n/a'}] ${ctx.raw.pattern} ${res.status} (${outcome})`,
    );
  }
}

/**
 * Слой наблюдаемости: кладёт `requestId` в контекст и пишет аудит.
 *
 * Слой — значение. Endpoint подключает его через `pipeline:`, а политика в
 * `root.ts` проверяет по ссылке, что слой есть у каждого HTTP-endpoint'а.
 */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
