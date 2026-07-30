import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Fail } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

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

export const updateUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (payload: UpdateUserInput): Output<UpdateUserOutput> => {
    logger.log(`Handling PATCH /api/users/${payload.id}`);

    const { id, ...updateData } = payload;

    // Проверка на наличие данных для обновления
    if (Object.keys(updateData).length === 0) {
      throw Fail.badRequest('No data to update');
    }

    // Проверка на дубликат email, если он указан
    if (updateData.email) {
      const existing = await users.findByEmail(updateData.email);
      if (existing && existing.id !== id) {
        throw Fail.badRequest('Email already taken', { field: 'email' });
      }
    }

    const user = await users.update(id, updateData);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    // Возвращаем напрямую - автоматически обернется в Ok
    return user;
  };

/**
 * Endpoint для обновления пользователя
 * Демонстрирует:
 * - Возврат через просто объект (без new Ok())
 * - Fail.notFound() если пользователь не найден
 * - Fail.badRequest() если невалидные данные
 */
export const UpdateUser = httpEndpoint({
  method: 'PATCH',
  path: '/api/users/:id',
  input: UpdateUserInput,
  output: UpdateUserOutput,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: updateUserHandler,
});
