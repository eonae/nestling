import { CreateUser as CreateUserOperation } from '../../api/operations';
import { authed } from '../../auth';
import type { NewUser, User } from '../user';
import { EmailTaken } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { FailOf } from '@nestling/operations';
import { Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const createUserHandler =
  (users: UsersRepository) =>
  async (payload: NewUser): Output<User, FailOf<typeof EmailTaken>> => {
    if (await users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }

    const user = await users.insert(payload);

    // Статус 201 и заголовок задаются на успешном ответе
    return Ok.created(user, { Location: `/users/${user.id}` });
  };

/** Создание требует токен: слой `authed` проверяет его до хендлера */
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  deps: [UsersRepository$],
  handle: createUserHandler,
});
