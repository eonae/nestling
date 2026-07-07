import { ADMIN_USER_ID } from '../../../common/constants';
import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({
  id: z.string(),
});

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

/**
 * Endpoint для удаления пользователя
 * Демонстрирует:
 * - Ok.noContent() для успешного удаления
 * - Fail.notFound() если пользователь не найден
 * - Fail.forbidden() если нельзя удалить (admin user)
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('DELETE', '/api/users/:id', {
  input: DeleteUserInput,
  pipeline: basePipeline,
})
export class DeleteUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: DeleteUserInput): Output<null> {
    this.logger.log(`Handling DELETE /api/users/${payload.id}`);

    // Проверка на защищенного пользователя
    if (payload.id === ADMIN_USER_ID) {
      throw Fail.forbidden('Cannot delete admin user');
    }

    const deleted = await this.userService.delete(payload.id);

    if (!deleted) {
      throw Fail.notFound('User not found');
    }

    return Ok.noContent();
  }
}
