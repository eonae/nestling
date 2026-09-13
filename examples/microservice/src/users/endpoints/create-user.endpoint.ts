import { CreateUser as CreateUserOperation } from '../../api/operations.js';
import { transactional } from '../../persistence.js';
import { ActivityHub } from '../activity.hub.js';
import type { CreateUserInput } from '../user.js';
import { EmailTaken } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Handler } from '@nestlingjs/container';
import type { DeclaredOutput, OutputFormOf } from '@nestlingjs/operations';
import { Ok } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';

@Handler([UsersRepository$, ActivityHub])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    input: CreateUserInput,
  ): DeclaredOutput<
    OutputFormOf<typeof CreateUserOperation>,
    typeof EmailTaken
  > {
    const { dryRun, ...data } = input;

    if (await this.users.byEmail(data.email)) {
      return EmailTaken({ email: data.email });
    }

    // Проверка без записи: исход `ok`, то есть 200 — записи не было, и
    // обещать 201 нельзя
    if (dryRun) {
      return new Ok({ id: 'dry-run', ...data });
    }

    const user = await this.users.insert(data);

    // Лента активности: `publish` не ждёт ни одного подписчика
    this.activity.publish('created', user.id);

    // Исход `created` объявлен развилкой операции и от транспорта не
    // зависит. Заголовок ответа — HTTP-форма, а её реализация операции не
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
