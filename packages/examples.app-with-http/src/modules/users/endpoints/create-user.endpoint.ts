import { Injectable } from '@nestling/container';
import type { AnyMeta, IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
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
@HttpEndpoint('POST', '/api/users', {
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: basePipeline,
})
export class CreateUserEndpoint implements IEndpoint
{
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(input: CreateUserInput): Output<CreateUserOutput> {
    this.logger.log(`Handling POST /api/users - creating user ${input.name}`);

    // Проверка на дубликат email
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }

    const user = await this.users.create(input);

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  }
}
