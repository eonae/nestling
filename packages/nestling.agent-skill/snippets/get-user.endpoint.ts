import type { GetUserInput, User } from './api-operations.js';
import { GetUser as GetUserOperation } from './api-operations.js';
import { UserNotFound } from './errors.js';
import { observability } from './pipeline.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/**
 * `@Handler` marks a handler class; the method is always named `handle`.
 * Export it when a unit test should be able to `new` it directly.
 */
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(payload: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(payload.id);

    // The failure is returned, not thrown. For the response it is the same
    return user ?? UserNotFound({ id: payload.id });
  }
}

/**
 * The address, the schemas and `errors:` belong to the operation, which the
 * client imports too. Only execution is declared here.
 */
export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  handler: GetUserHandler,
});
