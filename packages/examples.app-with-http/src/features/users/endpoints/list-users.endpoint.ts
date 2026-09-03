import { AppConfig } from '../../../app.config';
import { observability } from '../../../plugins/logging';
import { User } from '../user';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { Config } from '@nestling/config';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// GET без тела: поля `input` читаются из query-строки. Query несёт строки,
// число из них делает схема
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

export const listUsersHandler =
  (users: UsersRepository, config: Config<typeof AppConfig>) =>
  async (payload: ListUsersInput): Output<User[]> => {
    const rows = await users.all();

    return rows.slice(0, payload.limit ?? config.pageSize);
  };

export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: {
    deps: [UsersRepository$, AppConfig],
    handle: listUsersHandler,
  },
});
