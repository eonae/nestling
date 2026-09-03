import { observability } from '../../observability';
import { User } from '../user';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import { Ok, stream } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

/** Верхняя граница строк одной выгрузки: сверх неё поток обрывается */
const MAX_ROWS = 100_000;

async function* rows(users: UsersRepository): AsyncIterableIterator<User> {
  for (const user of await users.all()) {
    yield user;
  }
}

export const exportUsersHandler =
  (users: UsersRepository) => async (): Output<AsyncIterableIterator<User>> =>
    new Ok(rows(users), {
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });

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
  deps: [UsersRepository$],
  handle: exportUsersHandler,
});
