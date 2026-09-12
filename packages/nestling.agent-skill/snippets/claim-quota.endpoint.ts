import {
  ClaimQuota,
  QuotaExceeded,
  UserRegistered,
} from './intercom-operations.js';

import type { Logger } from '@nestlingjs/app';
import { implement, Logger$ } from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';

@Component([])
export class QuotaService {
  readonly limit = 5;

  #used = 0;

  claim(): boolean {
    return this.#used++ < this.limit;
  }
}

@Handler([QuotaService])
class ClaimQuotaHandler {
  constructor(private readonly quotas: QuotaService) {}

  async handle(_payload: { email: string }) {
    return this.quotas.claim()
      ? { remaining: this.quotas.limit }
      : QuotaExceeded({ limit: this.quotas.limit });
  }
}

/** `input`, `output` and `errors` belong to the operation */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  handler: ClaimQuotaHandler,
});

@Handler([Logger$.auto])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: { id: string; email: string }) {
    this.logger.info('quota bookkeeping', { userId: payload.id });
  }
}

export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: UserRegisteredInQuotasHandler,
});
