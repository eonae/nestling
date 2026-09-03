import type { Logger } from '../../plugins/logging';
import { Logger$ } from '../../plugins/logging';

import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx } from '@nestling/pipeline';
import { IdempotencyKey } from '@nestling/ports';

/**
 * Журнал регистраций: читает ключ идемпотентности из контекста.
 *
 * Ключ не передаётся параметром: `Ctx(IdempotencyKey)` — обычный узел
 * графа. В контекст ключ кладёт pre-юнит `withIdempotencyKey()` в
 * пайплайне реализации команды.
 *
 * Дедупликации здесь нет: ядро доставляет ключ до обработчика, а что с
 * ним делать, решает владелец команды.
 */
@Injectable([Logger$, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Записывает регистрацию вместе с ключом идемпотентности */
  record(userId: string): void {
    this.logger.debug(`signup ${userId} recorded, intent ${this.intent.get()}`);
  }
}
