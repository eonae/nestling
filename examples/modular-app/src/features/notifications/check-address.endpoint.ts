import { base } from '../../base.js';
import type { CheckAddressInput } from '../../operations.js';
import { AddressRejected, CheckAddress } from '../../operations.js';

import { Suppressions } from './suppressions.js';

import { implement } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([Suppressions])
class CheckAddressHandler {
  constructor(private readonly suppressions: Suppressions) {}

  async handle(payload: CheckAddressInput) {
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
  pipeline: base,
  handler: CheckAddressHandler,
});
