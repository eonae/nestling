/**
 * Фикстура: функция-хендлер возвращает не то, что описывает `output`.
 *
 * Снапшот фиксирует читаемость сверки со схемой: сообщение обязано
 * доводить до несовпавшего поля, а не тонуть в раскрытии дженериков.
 */

import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { User, UserInput } from '../support/fixture-kit.js';

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  handler: async () => new Ok({ unexpected: true }),
});
