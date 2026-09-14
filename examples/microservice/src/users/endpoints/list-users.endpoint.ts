import type { ListUsersInput } from '../../api/operations.js';
import { ListUsers as ListUsersOperation } from '../../api/operations.js';
import { AppConfig } from '../../app.config.js';
import { traced } from '../../observability.js';
import type { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Config, Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/**
 * Хендлер — класс с методом `handle`. Экземпляр создаёт фреймворк:
 * зависимости перечислены в `@Handler` и приходят в конструктор.
 */
@Handler([UsersRepository$, AppConfig])
export class ListUsersHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  async handle(input: ListUsersInput): Output<User[]> {
    const rows = await this.users.all();

    return rows.slice(0, input.limit ?? this.config.pageSize);
  }
}

/**
 * Адрес, схемы и описание живут в операции `api/operations.ts`: ту же
 * операцию импортирует клиент командной строки.
 */
export const ListUsers = httpEndpoint.implement(ListUsersOperation, {
  pipeline: traced,
  handler: ListUsersHandler,
});
