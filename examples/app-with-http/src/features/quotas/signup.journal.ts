import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, IdempotencyKey, Logger$ } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

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
@Component([Logger$.auto, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Записывает регистрацию вместе с ключом идемпотентности */
  record(userId: string): void {
    this.logger.debug('signup recorded', {
      userId,
      intent: this.intent.get(),
    });
  }
}
