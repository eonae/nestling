import { base } from '../../base.js';
import type { ForgetAddressInput } from '../../operations.js';
import { ForgetAddress } from '../../operations.js';

import { Suppressions } from './suppressions.js';

import type { CtxReader, Logger } from '@nestlingjs/app';
import {
  compose,
  Ctx,
  IdempotencyKey,
  implement,
  Logger$,
  makePipeline,
  withIdempotencyKey,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([Suppressions, Ctx(IdempotencyKey), Logger$.auto])
class ForgetAddressHandler {
  constructor(
    private readonly suppressions: Suppressions,
    private readonly intent: CtxReader<string>,
    private readonly logger: Logger,
  ) {}

  async handle(payload: ForgetAddressInput): Promise<void> {
    this.suppressions.suppress(payload.email, 'user asked to be forgotten');

    // Ключ не передаётся параметром: `Ctx(IdempotencyKey)` — обычный узел
    // графа. В контекст ключ кладёт pre-шаг `withIdempotencyKey()`
    this.logger.info('address forgotten', { intent: this.intent.get() });
  }
}

/**
 * Реализация команды `notifications.forget-address`.
 *
 * Pre-шаг `withIdempotencyKey()` кладёт ключ в контекст. Что шаг есть в
 * пайплайне, проверяет политика в `app.ts`. Дедупликации здесь нет: ядро
 * доставляет ключ до обработчика, а что с ним делать, решает владелец
 * команды.
 */
export const ForgetAddressImpl = implement(ForgetAddress, {
  pipeline: compose(base, makePipeline().pre(withIdempotencyKey())),
  handler: ForgetAddressHandler,
});
