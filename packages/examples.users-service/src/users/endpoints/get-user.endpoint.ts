import type { GetUserInput } from '../../api/operations';
import { GetUser as GetUserOperation } from '../../api/operations';
import { observability } from '../../observability';
import type { User } from '../user';
import { UserNotFound } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { FailOf } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const getUserHandler =
  (users: UsersRepository) =>
  async (payload: GetUserInput): Output<User, FailOf<typeof UserNotFound>> => {
    const user = await users.byId(payload.id);

    // Отказ возвращается значением. Для ответа это то же, что бросок
    return user ?? UserNotFound({ id: payload.id });
  };

/**
 * Адрес, схемы и `errors:` живут в операции `api/operations.ts`: ту же
 * операцию импортирует клиент. Здесь остаётся только исполнение.
 */
export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  deps: [UsersRepository$],
  handle: getUserHandler,
});
