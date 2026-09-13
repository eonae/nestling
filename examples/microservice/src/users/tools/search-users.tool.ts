import { observability } from '../../observability.js';
import { User } from '../user.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { mcpTool } from '@nestlingjs/mcp';
import { z } from 'zod';

const SearchUsersInput = z.object({
  query: z.string().min(1).describe('Подстрока адреса почты'),
});

type SearchUsersInput = z.infer<typeof SearchUsersInput>;

const SearchUsersOutput = z.object({
  total: z.number(),
  users: z.array(User),
});

type SearchUsersOutput = z.infer<typeof SearchUsersOutput>;

@Handler([UsersRepository$])
class SearchUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle({ query }: SearchUsersInput): Output<SearchUsersOutput> {
    const needle = query.toLowerCase();
    const all = await this.users.all();
    const found = all.filter((user) =>
      user.email.toLowerCase().includes(needle),
    );

    return { total: found.length, users: found };
  }
}

/**
 * Инструмент, которого в HTTP-API нет.
 *
 * Анонимная форма: адрес, схемы и описание объявлены здесь же. Так
 * объявляется то, что нужно агенту и не нужно клиенту API, — поиск по
 * подстроке вместо страничного списка.
 */
export const SearchUsersTool = mcpTool('search_users', {
  description:
    'Найти пользователей по подстроке в адресе почты. Возвращает число ' +
    'найденных и их карточки.',
  annotations: { readOnlyHint: true },
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: observability,
  handler: SearchUsersHandler,
});
