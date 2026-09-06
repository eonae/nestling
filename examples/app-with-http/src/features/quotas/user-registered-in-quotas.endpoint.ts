import type { UserRegisteredInput } from '../../operations.js';
import { UserRegistered } from '../../operations.js';

import type { Logger } from '@nestling/app';
import { implement, Logger$ } from '@nestling/app';
import { Injectable } from '@nestling/container';

@Injectable([Logger$.auto])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.info('quota bookkeeping', {
      userId: payload.id,
      email: payload.email,
    });
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
