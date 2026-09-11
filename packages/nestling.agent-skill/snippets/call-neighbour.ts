import { ClaimQuota, UserRegistered } from './intercom-operations.js';

import type { Emitter, Port } from '@nestlingjs/app';
import { deadlineIn } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([ClaimQuota.caller, UserRegistered.emitter])
export class SignUp {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  async handle(payload: { email: string }) {
    // A deadline is a moment, not a duration: it does not stretch on `await`
    const claimed = await this.quotas.call(payload, {
      deadline: deadlineIn(500),
    });

    if (claimed.isFail) {
      return claimed;
    }

    await this.registered.emit({ id: '2', email: payload.email });

    return { id: '2', email: payload.email };
  }
}
