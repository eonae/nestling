import { ADMIN_USER_ID } from '../../../common/constants';
import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({
  id: z.string(),
});

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

export const deleteUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (payload: DeleteUserInput): Output<null> => {
    logger.log(`Handling DELETE /api/users/${payload.id}`);

    // Проверка на защищенного пользователя
    if (payload.id === ADMIN_USER_ID) {
      throw Fail.forbidden('Cannot delete admin user');
    }

    const deleted = await users.delete(payload.id);

    if (!deleted) {
      throw Fail.notFound('User not found');
    }

    return Ok.noContent();
  };

/**
 * Endpoint для удаления пользователя
 * Демонстрирует:
 * - Ok.noContent() для успешного удаления
 * - Fail.notFound() если пользователь не найден
 * - Fail.forbidden() если нельзя удалить (admin user)
 */
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/api/users/:id',
  input: DeleteUserInput,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: deleteUserHandler,
});
