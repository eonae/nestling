import { authed } from '../../auth';
import { Unauthorized } from '../../errors';
import { UserNotFound } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { FailOf } from '@nestling/operations';
import { Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({ id: z.string() });

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

export const deleteUserHandler =
  (users: UsersRepository) =>
  async (
    payload: DeleteUserInput,
  ): Output<null, FailOf<typeof UserNotFound>> => {
    const removed = await users.remove(payload.id);

    return removed ? Ok.noContent() : UserNotFound({ id: payload.id });
  };

/**
 * Отказ `Unauthorized` бросает слой, а не хендлер, но объявляет его
 * endpoint: список `errors:` описывает всё, что может получить клиент.
 */
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound, Unauthorized],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: authed,
  handler: {
    deps: [UsersRepository$],
    handle: deleteUserHandler,
  },
});
