import { ClaimQuota } from './intercom-operations.js';

import type { Port } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * A port call, a stub and a client all answer `Ok | Fail`. The branch on
 * `isFail` is what narrows the type: after it `value` is typed by the
 * output schema of the operation.
 */
@Handler([ClaimQuota.caller])
export class Reserve {
  constructor(private readonly quotas: Port<typeof ClaimQuota>) {}

  async handle(input: { email: string }) {
    // #region reading
    const claimed = await this.quotas.call(input);

    if (claimed.isFail) {
      return claimed; // pass it on, if it is declared in errors:
    }

    return claimed.value; // typed by the output schema of the operation
    // #endregion
  }
}
