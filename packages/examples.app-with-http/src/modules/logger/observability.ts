import type { ILoggerService } from './logger.service';
import { ILogger } from './logger.service';

import { Injectable } from '@nestling/container';
import type {
  ExtendableContext,
  Outcome,
  ResponseContext,
} from '@nestling/pipeline';
import { makePipeline, withRequestId } from '@nestling/pipeline';

/**
 * Наблюдатель исхода запроса: пишет строку аудита в `.finally`.
 *
 * Это класс, а не функция, потому что ему нужен логгер того же модуля.
 * Класс в `.finally` контейнер создаёт на сборке; незарегистрированный
 * упал бы на фазе ASSEMBLE.
 */
@Injectable([ILogger])
export class AuditOutcome {
  constructor(private readonly logger: ILoggerService) {}

  handle(
    outcome: Outcome,
    _res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // При ошибке поля своего слоя опциональны: `requestId` мог не успеть
    // добавиться, отсюда `?? 'n/a'`
    this.logger.log(
      `[audit] ${ctx.raw.pattern} → ${outcome} (requestId=${ctx.input.requestId ?? 'n/a'})`,
    );
  }
}

/**
 * Слой наблюдаемости: `requestId` в контексте и аудит исхода.
 *
 * Модуль логирования экспортирует слой как значение, и каждый endpoint
 * подключает его явно через `compose`. Что слой есть у всех, проверяет
 * политика в корне: `everyEndpoint(…).hasLayer(observability)`. Слой
 * сравнивается по ссылке, поэтому одноимённая копия политику не
 * удовлетворит.
 *
 * `.finally` вызывается всегда и последним, с исходом `completed`,
 * `disconnected`, `aborted` или `failed`.
 */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
