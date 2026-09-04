/**
 * Фикстура: класс-хендлер возвращает не то, что описывает `output`.
 *
 * Снапшот фиксирует, что у класс-формы сверка со схемой доводит до того
 * же места, что у функции: диагностика обязана называть метод `handle`.
 */

import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { User, UserInput } from '../support/fixture-kit.js';

class GetUserHandler {
  async handle() {
    return new Ok({ unexpected: true });
  }
}

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  handler: GetUserHandler,
});
