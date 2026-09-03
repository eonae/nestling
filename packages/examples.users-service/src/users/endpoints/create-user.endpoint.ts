import { CreateUser as CreateUserOperation } from '../../api/operations';
import { authed } from '../../auth';
import type { CreateUserInput, User } from '../user';
import { EmailTaken } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import { Injectable } from '@nestling/container';
import { Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

@Injectable([UsersRepository$])
export class CreateUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: CreateUserInput): Output<User, typeof EmailTaken> {
    const { dryRun, ...data } = input;

    if (await this.users.byEmail(data.email)) {
      return EmailTaken({ email: data.email });
    }

    // Проверка без записи: клиент видит, каким получился бы пользователь
    if (dryRun) {
      return { id: 'dry-run', ...data };
    }

    const user = await this.users.insert(data);

    // Статус `created` и заголовок — метаданные ответа. Что с заголовком
    // сделает транспорт, решает транспорт: HTTP пишет его в ответ
    return Ok.created(user, { Location: `/users/${user.id}` });
  }
}

/** Создание требует токен: слой `authed` проверяет его до хендлера */
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: CreateUserHandler,
});
