import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { SearchQueryRequired } from '../user.errors';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const SearchUsersInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.string().transform(Number).optional(),
});

const SearchUsersOutput = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
);

type SearchUsersInput = z.infer<typeof SearchUsersInput>;
type SearchUsersOutput = z.infer<typeof SearchUsersOutput>;

/**
 * Класс-хендлер — вторая форма подключения DI.
 *
 * `implements` не нужен: сигнатура `handle` сверяется со схемами в точке
 * декларации. Класс — обычный `@Injectable`-провайдер и регистрируется в
 * `providers:` модуля явно, как любая другая зависимость.
 */
@Injectable([UserService, ILogger])
export class SearchUsersHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(
    payload: SearchUsersInput,
  ): Output<SearchUsersOutput, ReturnType<typeof SearchQueryRequired>> {
    this.logger.log(`Handling GET /api/users/search?q=${payload.q}`);

    if (!payload.q || payload.q.trim().length === 0) {
      return SearchQueryRequired();
    }

    let users = await this.users.search(payload.q);

    // Применяем `limit`, если он указан.
    if (payload.limit && payload.limit > 0) {
      users = users.slice(0, payload.limit);
    }

    return new Ok(users, {
      'X-Total-Count': String(users.length),
      'Cache-Control': 'max-age=60',
    });
  }
}

/**
 * Endpoint для поиска пользователей.
 *
 * Демонстрирует:
 * - работу с query-параметрами;
 * - возврат с кастомными заголовками (`X-Total-Count`, `Cache-Control`);
 * - объявленные отказы в класс-форме хендлера: вывод `E` из `errors:`
 *   работает во всех трёх формах `handle`.
 */
export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/search',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  errors: [SearchQueryRequired],
  pipeline: basePipeline,
  handle: SearchUsersHandler,
});
