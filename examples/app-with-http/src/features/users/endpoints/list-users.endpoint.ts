import { AppConfig } from '../../../app.config.js';
import { observability } from '../../../plugins/observability/index.js';
import { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Config, Output } from '@nestling/app';
import { Injectable } from '@nestling/container';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// GET без тела: поля `input` читаются из query-строки. Query несёт строки,
// число из них делает схема
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

@Injectable([UsersRepository$, AppConfig])
class ListUsersHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  async handle(payload: ListUsersInput): Output<User[]> {
    const rows = await this.users.all();

    return rows.slice(0, payload.limit ?? this.config.pageSize);
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
