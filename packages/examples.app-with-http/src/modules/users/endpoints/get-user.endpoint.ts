import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
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

export const getUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (payload: GetUserInput): Output<GetUserOutput> => {
    logger.log(`Handling GET /api/users/${payload.id}`);

    const user = await users.getById(payload.id);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    // Генерируем ETag на основе данных
    const etag = `"${user.id}-${user.email}"`;

    return new Ok(user, {
      ETag: etag,
      'Cache-Control': 'max-age=300',
    });
  };

/**
 * Endpoint для получения пользователя по ID
 */
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/api/users/:id',
  input: GetUserInput,
  output: GetUserOutput,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: getUserHandler,
});
