import { observability } from '../../../plugins/logging/index.js';
import { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Injectable } from '@nestling/container';
import { Ok, stream } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

/** Верхняя граница строк одной выгрузки: сверх неё поток обрывается */
const MAX_ROWS = 100_000;

/**
 * Класс-хендлер: форма для хендлера с зависимостями.
 *
 * Зависимости перечисляет `@Injectable`, а не поле декларации: у endpoint'а
 * `deps` нет. Сигнатура `handle` сверяется со схемами в точке декларации,
 * `implements` не нужен. Без зависимостей хендлер объявляется обычной
 * функцией, как у `Health`.
 */
@Injectable([UsersRepository$])
export class ExportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    const users = this.users;

    async function* rows(): AsyncIterableIterator<User> {
      for (const user of await users.all()) {
        yield user;
      }
    }

    return new Ok(rows(), {
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}

/**
 * Форма `stream(T)` на выходе: хендлер возвращает `AsyncIterable`,
 * транспорт отдаёт NDJSON. `Content-Type` задаёт форма, не хендлер.
 */
export const ExportUsers = httpEndpoint({
  method: 'GET',
  path: '/users/export',
  output: stream(User).limit(MAX_ROWS),
  doc: { summary: 'Выгрузка пользователей в NDJSON', tags: ['users'] },
  pipeline: observability,
  handler: ExportUsersHandler,
});
