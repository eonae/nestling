import type { Logger } from '../../plugins/logging/index.js';
import { Logger$ } from '../../plugins/logging/index.js';

import type { CtxReader } from '@nestling/app';
import { Ctx, IdempotencyKey } from '@nestling/app';
import { Injectable } from '@nestling/container';

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
