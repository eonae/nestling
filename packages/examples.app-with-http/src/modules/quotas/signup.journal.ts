import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx } from '@nestling/pipeline';
import { IdempotencyKey } from '@nestling/ports';

/**
 * Журнал регистраций: сервис в глубине графа, который читает ключ
 * идемпотентности из контекста.
 *
 * Ключ не передаётся параметром. `Ctx(IdempotencyKey)` — обычный узел
 * графа, и зависимость от контекста запроса видна в визуализации и в
 * `explain()`. Ключ в контекст кладёт pre-юнит `withIdempotencyKey()` в
 * пайплайне реализации; что он есть, проверяет на сборке
 * `everyEndpoint(…).hasVar(IdempotencyKey)`.
 *
 * Дедупликации здесь нет, и ядро её не делает: ядро гарантирует, что ключ
 * пройдёт через транспорт и будет доступен обработчику. Обёртку, которая
 * по ключу отсеет повтор, приложение пишет само.
 */
@Injectable([ILogger, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: ILoggerService,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Записывает регистрацию вместе с ключом идемпотентности */
  record(userId: string): void {
    this.logger.debug(`signup ${userId} recorded, intent ${this.intent.get()}`);
  }
}
