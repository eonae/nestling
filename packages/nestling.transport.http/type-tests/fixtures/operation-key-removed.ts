/**
 * Фикстура: ключ `operation` в словаре `httpEndpoint`.
 *
 * Ключа больше нет: реализацию операции создаёт `httpEndpoint.implement`.
 * Снапшот фиксирует текст, который увидит автор, переносящий такую
 * декларацию.
 */

import { Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

import { CreateUser as CreateUserOperation } from '../support/fixture-kit.js';

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  handler: async () => new Ok({ id: 'u-1', email: 'a@b.c' }),
});
