import { CreateUser as CreateUserOperation } from '../../api/operations.js';
import { transactional } from '../../persistence.js';
import type { CreateUserInput, User } from '../user.js';
import { EmailTaken } from '../users.errors.js';
import { UserCreated } from '../users.events.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';
import type { OutboxEmitter } from '@nestlingjs/outbox';
import { outboxed } from '@nestlingjs/outbox';
import { httpEndpoint } from '@nestlingjs/transport.http';

/**
 * `outboxed(UserCreated)` вместо `UserCreated.emitter` — одна строка в
 * списке зависимостей. Значение присваивается `Emitter<C>`, а его
 * словарь `meta` дополнен разделом записи. Меняется момент доставки:
 * запись уходит в шину после коммита, а не во время запроса.
 */
@Handler([UsersRepository$, outboxed(UserCreated)])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly userCreated: OutboxEmitter<typeof UserCreated>,
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
    // процесс сразу после коммита, событие всё равно уйдёт. Раздел —
    // идентификатор пользователя: его события доставляются по порядку
    await this.userCreated.emit(
      { id: user.id, name: user.name, email: user.email },
      { partitionKey: user.id },
    );

    // Статус `created` от транспорта не зависит и остаётся у обеих форм
    // хендлера. Заголовок ответа — HTTP-форма, а её реализация операции не
    // принимает: класс обязан оставаться переносимым на шину
    return Ok.created(user);
  }
}

/**
 * Создание идёт в транзакции: слой `transactional` открывает её до
 * хендлера, коммитит на успехе и откатывает на отказе. Проверку
 * Bearer-токена он приносит с собой — `transactional` композирован от
 * `authed`.
 */
export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: transactional,
  handler: CreateUserHandler,
});
