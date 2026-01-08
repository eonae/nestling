import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from './logger.service';
import { ILogger } from './logger.service';
import { UserService } from './user.service';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
});

const CreateUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

/**
 * Endpoint для создания пользователя
 */
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'POST /api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
})
export class CreateUserEndpoint implements IEndpoint {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: CreateUserInput): Output<CreateUserOutput> {
    this.logger.log(`Handling POST /api/users - creating user ${payload.name}`);

    const user = await this.users.create(payload);

    return Ok.created(user);
  }
}

