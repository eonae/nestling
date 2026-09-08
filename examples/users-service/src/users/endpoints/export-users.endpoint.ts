import { observability } from '../../observability.js';
import { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Handler } from '@nestling/container';
import { stream } from '@nestling/operations';
import type { HttpOutput } from '@nestling/transport.http';
import { httpEndpoint, HttpResponse } from '@nestling/transport.http';

/** Верхняя граница строк одной выгрузки: сверх неё поток обрывается */
const MAX_ROWS = 100_000;

@Handler([UsersRepository$])
export class ExportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(): HttpOutput<AsyncIterableIterator<User>> {
    // Заголовки потокового ответа уходят до первого кадра
    return HttpResponse.of(this.rows(), {
      headers: { 'Content-Disposition': 'attachment; filename="users.ndjson"' },
    });
  }

  private async *rows(): AsyncIterableIterator<User> {
    for (const user of await this.users.all()) {
      yield user;
    }
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
