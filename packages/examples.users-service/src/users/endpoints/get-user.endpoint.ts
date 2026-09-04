import type { GetUserInput } from '../../api/operations.js';
import { GetUser as GetUserOperation } from '../../api/operations.js';
import { observability } from '../../observability.js';
import type { User } from '../user.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

@Injectable([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  /**
   * Отказ возвращается значением и виден в типе `Output`: определение
   * `UserNotFound` записано в нём напрямую.
   */
  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

/**
 * Адрес, схемы и `errors:` живут в операции `api/operations.ts`: ту же
 * операцию импортирует клиент. Здесь остаётся только исполнение.
 */
export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  handler: GetUserHandler,
});
