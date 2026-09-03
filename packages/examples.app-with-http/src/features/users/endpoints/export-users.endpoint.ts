import { observability } from '../../../plugins/logging';
import { User } from '../user';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import { Injectable } from '@nestling/container';
import { Ok, stream } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

/** Верхняя граница строк одной выгрузки: сверх неё поток обрывается */
const MAX_ROWS = 100_000;

/**
 * Альтернативная форма: класс-хендлер.
 *
 * Класс с `@Injectable` и методом `handle` регистрируется в `providers:`
 * модуля, и `deps` у декларации нет. Сигнатура `handle` сверяется со
 * схемами в точке декларации, `implements` не нужен. Основная форма в
 * остальных endpoint'ах: каррированная фабрика.
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
  handle: ExportUsersHandler,
});
