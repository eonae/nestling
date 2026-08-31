import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
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

    // Возвращаем напрямую, пайплайн сам обернёт в `Ok`.
    return users.getAll();
  };

/**
 * Endpoint для получения списка пользователей.
 */
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users',
  output: ListUsersOutput,
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: listUsersHandler,
});
