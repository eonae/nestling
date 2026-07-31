import { ADMIN_USER_ID } from '../../../common/constants';
import { auditDeletions, basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { UserNotDeletable, UserNotFound } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { compose, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({
  id: z.string(),
});

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

export const deleteUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (
    payload: DeleteUserInput,
  ): Output<
    null,
    ReturnType<typeof UserNotDeletable> | ReturnType<typeof UserNotFound>
  > => {
    logger.log(`Handling DELETE /api/users/${payload.id}`);

    // Проверка на защищенного пользователя
    if (payload.id === ADMIN_USER_ID) {
      throw UserNotDeletable({ id: payload.id, reason: 'admin user' });
    }

    const deleted = await users.delete(payload.id);

    if (!deleted) {
      throw UserNotFound({ id: payload.id });
    }

    return Ok.noContent();
  };

/**
 * Endpoint для удаления пользователя.
 *
 * Демонстрирует:
 * - `Ok.noContent()` для успешного удаления;
 * - `throw` объявленного отказа — механизм доставки значения, не иная
 *   семантика: для ответа возврат и бросок неразличимы;
 * - слой `auditDeletions`, разбирающий отказ в `.catch` по `.is()`.
 */
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/api/users/:id',
  input: DeleteUserInput,
  errors: [UserNotDeletable, UserNotFound],
  pipeline: compose(basePipeline, auditDeletions),
  deps: [UserService, ILogger],
  handle: deleteUserHandler,
});
