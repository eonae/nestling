import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Fail, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from './logger.service';
import { ILogger } from './logger.service';
import { UserService } from './user.service';

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
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: GetUserInput,
  output: GetUserOutput,
})
export class GetUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: GetUserOutput): Output<GetUserOutput> {
    this.logger.log(`Handling GET /api/users/${payload.id}`);

    const user = await this.userService.getById(payload.id);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    return new Ok(user);
  }
}
