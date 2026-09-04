import type { GetUserInput } from '../../../api/operations.js';
import { GetUser as GetUserOperation } from '../../../api/operations.js';
import { observability } from '../../../plugins/logging/index.js';
import type { User } from '../user.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const getUserHandler =
  (users: UsersRepository) =>
  async (payload: GetUserInput): Output<User, typeof UserNotFound> => {
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
  handler: {
    deps: [UsersRepository$],
    handle: getUserHandler,
  },
});
