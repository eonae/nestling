import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import { ADMIN_USER_ID } from '../../../common/constants';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';
import { HttpEndpoint } from '@nestling/transport.http';

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
})
export class DeleteUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle({ id }: DeleteUserInput): Output<null> {
    this.logger.log(`Handling DELETE /api/users/${id}`);

    // Проверка на защищенного пользователя
    if (id === ADMIN_USER_ID) {
      throw Fail.forbidden('Cannot delete admin user');
    }

    const deleted = await this.userService.delete(id);

    if (!deleted) {
      throw Fail.notFound('User not found');
    }

    return Ok.noContent();
  }
}

