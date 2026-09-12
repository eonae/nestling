import type { GetUserInput } from '../../../api/operations.js';
import { GetUser as GetUserOperation } from '../../../api/operations.js';
import { observability } from '../../../plugins/observability/index.js';
import type { User } from '../user.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

@Handler([UsersRepository$])
class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(payload: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(payload.id);

    // Отказ возвращается значением. Для ответа это то же, что бросок
    return user ?? UserNotFound({ id: payload.id });
  }
}

/**
 * Адрес, схемы и `errors:` живут в операции `api/operations.ts`: ту же
 * операцию импортирует клиент. Здесь остаётся только исполнение.
 */
export const GetUser = httpEndpoint.implement(GetUserOperation, {
  pipeline: observability,
  handler: GetUserHandler,
});
