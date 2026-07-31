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
 * Наблюдатель исхода — класс-юнит, а не функция: ему нужен логгер, который
 * поставляет тот же инфра-модуль. Класс в `.finally` резолвится контейнером
 * на сборке (незарегистрированный упал бы на фазе ASSEMBLE), поэтому слой
 * работает ровно там, где модуль логирования приехал в граф.
 */
@Injectable([ILogger])
export class AuditOutcome {
  constructor(private readonly logger: ILoggerService) {}

  handle(
    outcome: Outcome,
    _res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // На error-path собственные поля слоя опциональны (requestId мог не
    // успеть добавиться), отсюда `?? 'n/a'`
    this.logger.log(
      `[audit] ${ctx.raw.pattern} → ${outcome} (requestId=${ctx.input.requestId ?? 'n/a'})`,
    );
  }
}

/**
 * Внешний слой: наблюдаемость.
 *
 * Поставляется инфра-модулем логирования как **значение** — так сквозное
 * поведение попадает на ручки: их композируют от него явно, а вездесущность
 * гарантирует политика в корне (`everyEndpoint(…).hasLayer(observability)`).
 * Ambient middleware, который навесил бы слой невидимо, в ядре нет.
 *
 * Идентичность слоя ссылочная, поэтому политика адресует именно это
 * значение: одноимённая копия из соседнего файла её не удовлетворит.
 *
 * Демонстрирует ответный тракт pipeline v2: `.finally` — наблюдатель
 * исхода (completed | disconnected | aborted | failed), вызывается всегда,
 * последним.
 */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
