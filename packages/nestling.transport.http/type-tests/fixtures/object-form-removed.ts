/**
 * Фикстура: объектная форма `handler: { deps, handle }`.
 *
 * Формы больше нет. Снапшот фиксирует текст, который увидит автор,
 * переносящий такой endpoint на класс-хендлер.
 */

import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { User, UserInput } from '../support/fixture-kit.js';

class UserService {
  getById(id: string) {
    return { id, email: 'a@b.c' };
  }
}

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  handler: {
    deps: [UserService],
    handle: (users: UserService) => async (payload: { id: string }) =>
      new Ok(users.getById(payload.id)),
  },
});
