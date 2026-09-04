import type { UserRegisteredInput } from '../../operations.js';
import { UserRegistered } from '../../operations.js';
import type { Logger } from '../../plugins/logging/index.js';
import { Logger$ } from '../../plugins/logging/index.js';

import { Injectable } from '@nestling/container';
import { implement } from '@nestling/ports';

@Injectable([Logger$])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);
  }
}

/**
 * Подписчик события `users.registered`.
 *
 * У события может быть несколько подписчиков, поэтому `subscriber`
 * обязателен: он различает подписки в процессе (`users.registered@quotas`)
 * и становится именем queue-group у брокера.
 */
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: UserRegisteredInQuotasHandler,
});
