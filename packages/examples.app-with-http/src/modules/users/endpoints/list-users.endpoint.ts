import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ListUsersOutput = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
);

type ListUsersOutput = z.infer<typeof ListUsersOutput>;

export const listUsersHandler =
  (users: UserService, logger: ILoggerService) =>
  async (): Output<ListUsersOutput> => {
    logger.log('Handling GET /api/users');

    // Возвращаем напрямую - автоматически обернется в Ok
    return users.getAll();
  };

/**
 * Endpoint для получения списка пользователей
 */
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users',
  output: ListUsersOutput,
  pipeline: noValidationPipeline,
  deps: [UserService, ILogger],
  handle: listUsersHandler,
});
