import type { CreateUserInput, User } from './api-operations.js';
import { CreateUser as CreateUserOperation } from './api-operations.js';
import { EmailTaken } from './errors.js';
import type { QuotaExceeded } from './intercom-operations.js';
import { ClaimQuota } from './intercom-operations.js';
import { authed } from './pipeline.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Output, Port } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';

@Handler([UsersRepository$, ClaimQuota.caller])
class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly quotas: Port<typeof ClaimQuota>,
  ) {}

  /**
   * `Output<Value, Failures>` lists every failure this handler may return.
   * A failure outside `errors:` of the endpoint becomes `internal_error`.
   */
  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded> {
    if (await this.users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }

    const claimed = await this.quotas.call({ email: payload.email });

    if (claimed.isFail) {
      // The neighbour's failure is declared in `errors:` of the operation
      // and reaches the client unchanged
      return claimed;
    }

    // `Ok.created` sets the success status on the value; HTTP maps it to 201
    return Ok.created({ id: '2', name: payload.name, email: payload.email });
  }
}

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: CreateUserHandler,
});
