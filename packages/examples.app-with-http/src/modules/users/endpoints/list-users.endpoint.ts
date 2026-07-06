import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const ListUsersOutput = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
);

type ListUsersOutput = z.infer<typeof ListUsersOutput>;

/**
 * Endpoint для получения списка пользователей
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users', {
  output: ListUsersOutput,
  pipeline: noValidationPipeline,
})
export class ListUsersEndpoint implements IEndpoint
{
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: undefined, meta: {}): Output<ListUsersOutput> {
    this.logger.log('Handling GET /api/users');

    const users = await this.users.getAll();

    // Возвращаем напрямую - автоматически обернется в Ok
    return users;
  }
}
