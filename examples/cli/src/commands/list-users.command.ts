import { api } from '../api.js';

import { User } from '@examples/microservice/operations';
import type { Output } from '@nestlingjs/app';
import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

/**
 * Вход команды с формой значения: опции `--key value` попадают в
 * одноимённые поля. Значение из командной строки — строка, число из неё
 * делает схема.
 */
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

/** `list-users [--limit N]`: печатает список пользователей JSON'ом */
export const ListUsers = cliEndpoint('list-users', {
  input: ListUsersInput,
  output: z.array(User),
  handler: async (input: ListUsersInput): Output<User[]> =>
    api.listUsers({ limit: input.limit }),
});
