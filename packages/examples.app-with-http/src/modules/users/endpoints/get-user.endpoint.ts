import type { User } from '../../../api.contracts';
import { GetUser as GetUserContract } from '../../../api.contracts';
import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { UserNotFound } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import type { z } from 'zod';

interface GetUserInput {
  id: string;
}
type GetUserOutput = z.infer<typeof User>;

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
 * Endpoint для получения пользователя по ID — **контракт-форма**.
 *
 * Адрес, схемы и `errors:` принадлежат контракту: переобъявить их здесь —
 * ошибка компиляции. Тот же контракт импортирует внешний клиент, поэтому
 * разъехаться серверу и потребителю негде.
 *
 * Демонстрирует и канал `return`: множество отказов объявлено контрактом,
 * и компилятор не пропустит возврат отказа вне него.
 */
export const GetUser = httpEndpoint({
  contract: GetUserContract,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: getUserHandler,
});
