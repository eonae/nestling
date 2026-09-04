import type { ClaimQuotaInput } from '../../operations.js';
import { ClaimQuota, QuotaExceeded } from '../../operations.js';
import type { Logger } from '../../plugins/logging/index.js';
import { Logger$ } from '../../plugins/logging/index.js';

import { QuotaService } from './quota.service.js';

import { Injectable } from '@nestling/container';
import { implement } from '@nestling/ports';

@Injectable([QuotaService, Logger$])
class ClaimQuotaHandler {
  constructor(
    private readonly quotas: QuotaService,
    private readonly logger: Logger,
  ) {}

  async handle(payload: ClaimQuotaInput) {
    const claimed = this.quotas.claim();

    if (!claimed.ok) {
      this.logger.log(`quota exhausted, refusing ${payload.email}`);

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
