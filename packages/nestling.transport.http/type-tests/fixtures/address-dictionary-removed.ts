/**
 * Фикстура: адрес объявлен полями словаря, а сам `httpEndpoint` вызван.
 *
 * Формы больше нет: метод называет имя конструктора, путь идёт первым
 * аргументом. Снапшот фиксирует текст, который увидит автор, переносящий
 * такую декларацию.
 */

import { Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

import { User, UserInput } from '../support/fixture-kit.js';

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  handler: async () => new Ok({ id: 'u-1', email: 'a@b.c' }),
});
