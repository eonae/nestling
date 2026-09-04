/**
 * Фикстура: класс-хендлер возвращает отказ вне `errors:`.
 *
 * Снапшот фиксирует, что список отказов сверяется в обеих формах и
 * диагностика класс-формы называет тот же код.
 */

import { httpEndpoint } from '@nestling/transport.http';

import { CardDeclined, EmailTaken, User } from '../support/fixture-kit.js';

class CreateUserHandler {
  async handle() {
    return CardDeclined();
  }
}

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  output: User,
  errors: [EmailTaken],
  handler: CreateUserHandler,
});
