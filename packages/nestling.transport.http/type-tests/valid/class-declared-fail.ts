/**
 * Фикстура: класс-хендлер возвращает только объявленные отказы.
 *
 * Пара к `function-declared-fail`: у класса проверка стоит в слоте, и
 * верная декларация обязана проходить и там.
 */

import { EmailTaken, User } from '../support/fixture-kit.js';

import { Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

class CreateUserHandler {
  async handle() {
    return Math.random() > 0.5
      ? EmailTaken()
      : new Ok({ id: 'u-1', email: 'a@b.c' });
  }
}

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  output: User,
  errors: [EmailTaken],
  handler: CreateUserHandler,
});
