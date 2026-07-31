import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx } from '@nestling/pipeline';
import { IdempotencyKey } from '@nestling/ports';

/**
 * Журнал регистраций — сервис в глубине графа, читающий профиль вызова.
 *
 * Ключ идемпотентности не протаскивается сюда параметром: `Ctx(...)` — это
 * обычный узел графа, и его зависимость от request-контекста видна в
 * визуализации и в `explain()` наравне с прочими. Писатель ключа — штатный
 * pre-юнит `withIdempotencyKey()` в пайплайне реализации; присутствие
 * писателя проверяемо на сборке предикатом
 * `everyEndpoint(…).hasVar(IdempotencyKey)`.
 *
 * Дедупликации здесь нет и в ядре её нет: ядро гарантирует ровно две вещи —
 * ключ доедет через транспорт и будет доступен обработчику. Обёртка,
 * которая по этому ключу отсеет повтор, пишется **не трогая ядро**.
 */
@Injectable([ILogger, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: ILoggerService,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Фиксирует регистрацию, подписывая запись идентичностью намерения */
  record(userId: string): void {
    this.logger.debug(`signup ${userId} recorded, intent ${this.intent.get()}`);
  }
}
