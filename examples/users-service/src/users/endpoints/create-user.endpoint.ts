import { CreateUser as CreateUserOperation } from '../../api/operations.js';
import { transactional } from '../../persistence.js';
import type { CreateUserInput, User } from '../user.js';
import { EmailTaken } from '../users.errors.js';
import { UserCreated } from '../users.events.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestling/app';
import { Handler } from '@nestling/container';
import type { Emitter } from '@nestling/operations';
import { Ok } from '@nestling/operations';
import { outboxed } from '@nestling/outbox';
import { httpEndpoint } from '@nestling/transport.http';

/**
 * `outboxed(UserCreated)` вместо `UserCreated.emitter` — одна строка в
 * списке зависимостей. Тело метода от этого не меняется: тип значения тот
 * же `Emitter<C>`. Меняется момент доставки: запись уходит в шину после
 * коммита, а не во время запроса.
 */
@Handler([UsersRepository$, outboxed(UserCreated)])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly userCreated: Emitter<typeof UserCreated>,
  ) {}

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

    // Запись пользователя и запись события — одна транзакция. Упади
    // процесс сразу после коммита, событие всё равно уйдёт
    await this.userCreated.emit({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    // Статус `created` и заголовок — метаданные ответа. Что с заголовком
    // сделает транспорт, решает транспорт: HTTP пишет его в ответ
    return Ok.created(user, { Location: `/users/${user.id}` });
  }
}

/**
 * Создание идёт в транзакции: слой `transactional` открывает её до
 * хендлера, коммитит на успехе и откатывает на отказе. Проверку
 * Bearer-токена он приносит с собой — `transactional` композирован от
 * `authed`.
 */
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: transactional,
  handler: CreateUserHandler,
});
