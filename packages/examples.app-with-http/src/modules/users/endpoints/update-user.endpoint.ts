import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Fail } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const UpdateUserInput = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.email().optional(),
});

const UpdateUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type UpdateUserInput = z.infer<typeof UpdateUserInput>;
type UpdateUserOutput = z.infer<typeof UpdateUserOutput>;

/**
 * Endpoint для обновления пользователя
 * Демонстрирует:
 * - Возврат через просто объект (без new Ok())
 * - Fail.notFound() если пользователь не найден
 * - Fail.badRequest() если невалидные данные
 */
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'PATCH /api/users/:id',
  input: UpdateUserInput,
  output: UpdateUserOutput,
})
export class UpdateUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: UpdateUserInput): Output<UpdateUserOutput> {
    this.logger.log(`Handling PATCH /api/users/${payload.id}`);

    const { id, ...updateData } = payload;

    // Проверка на наличие данных для обновления
    if (Object.keys(updateData).length === 0) {
      throw Fail.badRequest('No data to update');
    }

    // Проверка на дубликат email, если он указан
    if (updateData.email) {
      const existing = await this.userService.findByEmail(updateData.email);
      if (existing && existing.id !== id) {
        throw Fail.badRequest('Email already taken', { field: 'email' });
      }
    }

    const user = await this.userService.update(id, updateData);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    // Возвращаем напрямую - автоматически обернется в Ok
    return user;
  }
}

