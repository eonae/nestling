import { AppConfig } from '../../app.config.js';
import { observability } from '../../observability.js';
import { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// GET без тела: поля `input` читаются из query-строки. Query несёт строки,
// число из них делает схема
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

/**
 * Хендлер — класс с методом `handle`. Экземпляр создаёт фреймворк:
 * зависимости перечислены в `@Injectable` и приходят в конструктор.
 */
@Injectable([UsersRepository$, AppConfig])
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

export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: ListUsersHandler,
});
