import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
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
 * Endpoint для поиска пользователей
 * Демонстрирует:
 * - Работа с query параметрами
 * - Возврат с кастомными заголовками (X-Total-Count, Cache-Control)
 * - Fail.badRequest() если query параметр отсутствует или невалидный
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users/search', {
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: basePipeline,
})
export class SearchUsersEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: SearchUsersInput): Output<SearchUsersOutput> {
    this.logger.log(`Handling GET /api/users/search?q=${payload.q}`);

    if (!payload.q || payload.q.trim().length === 0) {
      throw Fail.badRequest('Query parameter required');
    }

    let users = await this.userService.search(payload.q);

    // Применяем limit, если указан
    if (payload.limit && payload.limit > 0) {
      users = users.slice(0, payload.limit);
    }

    return new Ok(users, {
      'X-Total-Count': String(users.length),
      'Cache-Control': 'max-age=60',
    });
  }
}
