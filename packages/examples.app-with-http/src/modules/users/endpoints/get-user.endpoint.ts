import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserNotFound } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

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

export const getUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (
    payload: GetUserInput,
  ): Output<GetUserOutput, ReturnType<typeof UserNotFound>> => {
    logger.log(`Handling GET /api/users/${payload.id}`);

    const user = await users.getById(payload.id);

    // Канал возврата: отказ — обычное значение, `throw` не обязателен.
    // Рантайм трактует его ровно как бросок — `.ok`-юниты не увидят его
    // ни на одном из путей.
    if (!user) {
      return UserNotFound({ id: payload.id });
    }

    // Генерируем ETag на основе данных
    const etag = `"${user.id}-${user.email}"`;

    return new Ok(user, {
      ETag: etag,
      'Cache-Control': 'max-age=300',
    });
  };

/**
 * Endpoint для получения пользователя по ID.
 *
 * Демонстрирует канал `return`: множество отказов объявлено в `errors:`,
 * и компилятор не пропустит возврат отказа вне него.
 */
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/api/users/:id',
  input: GetUserInput,
  output: GetUserOutput,
  errors: [UserNotFound],
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: getUserHandler,
});
