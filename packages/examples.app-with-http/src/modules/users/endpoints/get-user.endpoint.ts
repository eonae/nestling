import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const GetUserInput = z.object({
  id: z.string(),
});

const GetUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type GetUserInput = z.infer<typeof GetUserInput>;
type GetUserOutput = z.infer<typeof GetUserOutput>;

/**
 * Endpoint для получения пользователя по ID
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users/:id', {
  input: GetUserInput,
  output: GetUserOutput,
  pipeline: basePipeline,
})
export class GetUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: GetUserInput): Output<GetUserOutput> {
    this.logger.log(`Handling GET /api/users/${payload.id}`);

    const user = await this.userService.getById(payload.id);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    // Генерируем ETag на основе данных
    const etag = `"${user.id}-${user.email}"`;

    return new Ok(user, {
      ETag: etag,
      'Cache-Control': 'max-age=300',
    });
  }
}
