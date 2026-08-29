import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { EmailTaken, NothingToUpdate, UserNotFound } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
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

/** Объявленный набор отказов endpoint'а — источник типа для `meta.fail`. */
type UpdateUserFails =
  | ReturnType<typeof NothingToUpdate>
  | ReturnType<typeof EmailTaken>
  | ReturnType<typeof UserNotFound>;

export const updateUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (
    payload: UpdateUserInput,
    meta: { fail: (e: UpdateUserFails) => never },
  ): Output<UpdateUserOutput, UpdateUserFails> => {
    logger.log(`Handling PATCH /api/users/${payload.id}`);

    const { id, ...updateData } = payload;

    // Проверка на наличие данных для обновления
    // Канал раннего выхода: `meta.fail` принимает только объявленные
    // отказы, а его тип `never` сохраняет анализ достижимости кода ниже.
    if (Object.keys(updateData).length === 0) {
      meta.fail(NothingToUpdate());
    }

    // Проверка на дубликат email, если он указан
    if (updateData.email) {
      const existing = await users.findByEmail(updateData.email);
      if (existing && existing.id !== id) {
        meta.fail(EmailTaken({ email: updateData.email }));
      }
    }

    const user = await users.update(id, updateData);

    if (!user) {
      meta.fail(UserNotFound({ id }));
    }

    // Возвращаем напрямую, пайплайн сам обернёт в `Ok`.
    return user;
  };

/**
 * Endpoint для обновления пользователя.
 *
 * Демонстрирует:
 * - возврат обычным объектом, без `new Ok()`;
 * - канал `meta.fail(...)` — типизированный ранний выход из глубины
 *   хендлера. Отказ вне `errors:` этот канал принять не может.
 */
export const UpdateUser = httpEndpoint({
  method: 'PATCH',
  path: '/api/users/:id',
  input: UpdateUserInput,
  output: UpdateUserOutput,
  errors: [NothingToUpdate, EmailTaken, UserNotFound],
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: updateUserHandler,
});
