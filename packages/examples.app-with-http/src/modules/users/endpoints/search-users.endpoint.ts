import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const SearchUsersInput = z.object({
  search: z.string().min(1, 'Search query is required'),
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
export class SearchUsersEndpoint
  implements IEndpoint<SearchUsersInput, {}, SearchUsersOutput>
{
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(input: SearchUsersInput): Output<SearchUsersOutput> {
    this.logger.log(`Handling GET /api/users/search?q=${input.search}`);

    if (!input.search || input.search.trim().length === 0) {
      throw Fail.badRequest('Query parameter required');
    }

    let users = await this.userService.search(input.search);

    // Применяем limit, если указан
    if (input.limit && input.limit > 0) {
      users = users.slice(0, input.limit);
    }

    return new Ok(users, {
      'X-Total-Count': String(users.length),
      'Cache-Control': 'max-age=60',
    });
  }
}
