import { Unauthorized } from '../../../errors.js';
import { authed } from '../../../plugins/auth/index.js';
import { User } from '../user.js';
import { EmailTaken, NothingToUpdate, UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UpdateUserInput = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.email().optional(),
});

type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/**
 * Несколько отказов у одного хендлера: каждый возвращается значением, и
 * тип `Output` перечисляет их определениями. Отказ вне списка не
 * компилируется.
 */
export const updateUserHandler =
  (users: UsersRepository) =>
  async (
    payload: UpdateUserInput,
  ): Output<
    User,
    typeof NothingToUpdate | typeof EmailTaken | typeof UserNotFound
  > => {
    const { id, ...changes } = payload;

    if (Object.keys(changes).length === 0) {
      return NothingToUpdate();
    }

    if (changes.email) {
      const existing = await users.byEmail(changes.email);
      if (existing && existing.id !== id) {
        return EmailTaken({ email: changes.email });
      }
    }

    const user = await users.patch(id, changes);

    return user ?? UserNotFound({ id });
  };

export const UpdateUser = httpEndpoint({
  method: 'PATCH',
  path: '/users/:id',
  input: UpdateUserInput,
  output: User,
  errors: [NothingToUpdate, EmailTaken, UserNotFound, Unauthorized],
  doc: { summary: 'Изменить пользователя', tags: ['users'] },
  pipeline: authed,
  handler: {
    deps: [UsersRepository$],
    handle: updateUserHandler,
  },
});
