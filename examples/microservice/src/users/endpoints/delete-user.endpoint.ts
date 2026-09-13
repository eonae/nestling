import { transactional } from '../../persistence.js';
import { ActivityHub } from '../activity.hub.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({ id: z.string() });

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

@Handler([UsersRepository$, ActivityHub])
export class DeleteUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    input: DeleteUserInput,
  ): Output<void, typeof UserNotFound, 'no_content'> {
    const removed = await this.users.remove(input.id);

    if (!removed) {
      return UserNotFound({ id: input.id });
    }

    this.activity.publish('deleted', input.id);

    return Ok.noContent();
  }
}

/**
 * `Unauthorized` объявляет слой `authed`, поэтому в `errors:` его нет:
 * эффективное множество endpoint'а складывается из этого списка и отказов
 * его слоёв.
 */
export const DeleteUser = httpEndpoint.delete('/users/:id', {
  input: DeleteUserInput,
  errors: [UserNotFound],
  // Ответа без тела: `output` не объявлен, и умолчание уже даёт
  // `no_content`. Поле названо вслух, потому что это контракт ответа
  status: 'no_content',
  doc: { summary: 'Удалить пользователя', tags: ['users'] },
  pipeline: transactional,
  handler: DeleteUserHandler,
});
