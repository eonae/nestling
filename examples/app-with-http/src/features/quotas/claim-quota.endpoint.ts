import type { ClaimQuotaInput } from '../../operations.js';
import { ClaimQuota, QuotaExceeded } from '../../operations.js';

import { QuotaService } from './quota.service.js';

import type { Logger } from '@nestling/app';
import { implement, Logger$ } from '@nestling/app';
import { Injectable } from '@nestling/container';

@Injectable([QuotaService, Logger$.auto])
class ClaimQuotaHandler {
  constructor(
    private readonly quotas: QuotaService,
    private readonly logger: Logger,
  ) {}

  async handle(payload: ClaimQuotaInput) {
    const claimed = this.quotas.claim();

    if (!claimed.ok) {
      this.logger.info('quota exhausted', { email: payload.email });

      // Вызывающий получит `Fail` и узнает его через `QuotaExceeded.is()`
      return QuotaExceeded({ limit: this.quotas.limit });
    }

    return { remaining: claimed.remaining };
  }
}

/**
 * Реализация запроса `quotas.claim`: декларация endpoint'а на транспорте
 * шины. `input`, `output` и `errors` принадлежат операции и здесь не
 * повторяются. Всё остальное как у HTTP-endpoint'а: класс-хендлер,
 * участие в discovery и политиках, вызов по значению в тестах.
 */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  handler: ClaimQuotaHandler,
});
