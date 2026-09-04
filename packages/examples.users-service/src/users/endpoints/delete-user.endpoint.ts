import { authed } from '../../auth.js';
import { Unauthorized } from '../../errors.js';
import { UserNotFound } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Injectable } from '@nestling/container';
import { Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const DeleteUserInput = z.object({ id: z.string() });

type DeleteUserInput = z.infer<typeof DeleteUserInput>;

@Injectable([UsersRepository$])
export class DeleteUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: DeleteUserInput): Output<null, typeof UserNotFound> {
    const removed = await this.users.remove(input.id);

    return removed ? Ok.noContent() : UserNotFound({ id: input.id });
  }
}

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
  pipeline: authed,
  handler: DeleteUserHandler,
});
