import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Fail, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

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

    // Проверка на дубликат email
    const existing = await this.users.findByEmail(payload.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }

    const user = await this.users.create(payload);

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  }
}

