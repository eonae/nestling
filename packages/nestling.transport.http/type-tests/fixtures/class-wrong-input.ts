/**
 * Фикстура: сигнатура `handle` не сходится со схемой `input`.
 *
 * Снапшот фиксирует диагностику класс-формы там, где у функции-хендлера
 * тип входа выводится контекстно: у класса он объявлен явно и потому
 * сверяется как обычный параметр.
 */

import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { User, UserInput } from '../support/fixture-kit.js';

class GetUserHandler {
  async handle(payload: { id: number }) {
    return new Ok({ id: String(payload.id), email: 'a@b.c' });
  }
}

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  handler: GetUserHandler,
});
