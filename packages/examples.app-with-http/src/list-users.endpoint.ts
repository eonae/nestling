import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from './logger.service';
import { ILogger } from './logger.service';
import { UserService } from './user.service';

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
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users',
  output: ListUsersOutput,
})
export class ListUsersEndpoint implements IEndpoint {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(): Output<ListUsersOutput> {
    this.logger.log('Handling GET /api/users');

    const users = await this.users.getAll();

    return new Ok(users);
  }
}

