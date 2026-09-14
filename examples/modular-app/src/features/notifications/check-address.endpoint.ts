import { traced } from '../../base.js';
import type { CheckAddressInput } from '../../operations.js';
import { AddressRejected, CheckAddress } from '../../operations.js';

import { Suppressions } from './suppressions.js';

import type { Logger } from '@nestlingjs/app';
import { implement, Logger$ } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([Suppressions, Logger$.auto])
class CheckAddressHandler {
  constructor(
    private readonly suppressions: Suppressions,
    private readonly logger: Logger,
  ) {}

  async handle(payload: CheckAddressInput) {
    // Запись этого процесса несёт тот же `traceId`, что запись соседнего:
    // трассу привёз конверт вызова, а базовый слой вернул её в контекст
    this.logger.info('address checked');

    const reason = this.suppressions.reasonFor(payload.email);

    return reason === undefined
      ? { deliverable: true }
      : // Вызывающий получит `Fail` и узнает его через `AddressRejected.is()`
        AddressRejected({ email: payload.email, reason });
  }
}

/**
 * Реализация запроса `notifications.check-address`.
 *
 * Базовый слой вернул арендатора и трассу в контекст запроса: оба
 * пришли в конверте вызова.
 */
export const CheckAddressImpl = implement(CheckAddress, {
  pipeline: traced,
  handler: CheckAddressHandler,
});
