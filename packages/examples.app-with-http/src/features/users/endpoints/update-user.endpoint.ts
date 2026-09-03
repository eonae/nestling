import { Unauthorized } from '../../../errors';
import { authed } from '../../../plugins/auth';
import { User } from '../user';
import { EmailTaken, NothingToUpdate, UserNotFound } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { FailOf } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UpdateUserInput = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.email().optional(),
});

type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/** Объявленные отказы endpoint'а: тип аргумента `meta.fail` */
type UpdateUserFails =
  | FailOf<typeof NothingToUpdate>
  | FailOf<typeof EmailTaken>
  | FailOf<typeof UserNotFound>;

/**
 * Альтернативная форма: ранний выход через `meta.fail`.
 *
 * `meta.fail` принимает только отказы из `errors:` и возвращает `never`,
 * поэтому код после него компилятор считает недостижимым. Основная форма
 * в остальных endpoint'ах: `return Fail`.
 */
export const updateUserHandler =
  (users: UsersRepository) =>
  async (
    payload: UpdateUserInput,
    meta: { fail: (e: UpdateUserFails) => never },
  ): Output<User, UpdateUserFails> => {
    const { id, ...changes } = payload;

    if (Object.keys(changes).length === 0) {
      meta.fail(NothingToUpdate());
    }

    if (changes.email) {
      const existing = await users.byEmail(changes.email);
      if (existing && existing.id !== id) {
        meta.fail(EmailTaken({ email: changes.email }));
      }
    }

    const user = await users.patch(id, changes);
    if (!user) {
      meta.fail(UserNotFound({ id }));
    }

    return user;
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
