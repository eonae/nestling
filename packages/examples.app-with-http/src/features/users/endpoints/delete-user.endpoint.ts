import { Unauthorized } from '../../../errors';
import { authed } from '../../../plugins/auth';
import type { Logger } from '../../../plugins/logging';
import { Logger$ } from '../../../plugins/logging';
import { UserNotFound } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import { Injectable } from '@nestling/container';
import { Ok } from '@nestling/operations';
import type { ErrorResponseContext, Output } from '@nestling/pipeline';
import { compose, makePipeline } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({ id: z.string() });

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

/**
 * Альтернативная форма: юнит `.catch`, который читает отказ.
 *
 * В `.catch` приходит контекст ответа, а не сам `Fail`, поэтому отказ
 * узнаётся через `.is()`. Юнит ничего не возвращает, и ответ идёт дальше
 * без изменений.
 */
@Injectable([Logger$])
export class AuditDeletion {
  constructor(private readonly logger: Logger) {}

  handle(res: ErrorResponseContext): void {
    if (UserNotFound.is(res.value)) {
      this.logger.log(`[audit] delete refused: ${res.value.message}`);
    }
  }
}

export const deleteUserHandler =
  (users: UsersRepository) =>
  async (payload: DeleteUserInput): Output<null, typeof UserNotFound> => {
    const removed = await users.remove(payload.id);

    return removed ? Ok.noContent() : UserNotFound({ id: payload.id });
  };

/**
 * Отказ `Unauthorized` бросает слой, а не хендлер, но объявляет его
 * endpoint: список `errors:` описывает всё, что может получить клиент.
 */
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound, Unauthorized],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: compose(authed, makePipeline().catch(AuditDeletion)),
  handler: {
    deps: [UsersRepository$],
    handle: deleteUserHandler,
  },
});
