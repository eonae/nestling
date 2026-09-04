/**
 * Фикстура: функция-хендлер возвращает отказ вне `errors:`.
 *
 * Снапшот фиксирует читаемость сверки со списком отказов: сообщение
 * обязано доводить до строки с кодом, которого нет в `errors:`.
 */

import { httpEndpoint } from '@nestling/transport.http';

import { CardDeclined, EmailTaken, User } from '../support/fixture-kit.js';

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  output: User,
  errors: [EmailTaken],
  handler: async () => CardDeclined(),
});
