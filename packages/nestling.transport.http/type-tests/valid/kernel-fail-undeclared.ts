/**
 * Фикстура: хендлер возвращает отказ ядра без объявления.
 *
 * Отказы ядра граница пропускает у любой декларации, и правило типов
 * повторяет правило границы: `errors:` здесь нет вовсе.
 */

import { User } from '../support/fixture-kit.js';

import { InternalError } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  output: User,
  handler: async () => InternalError(),
});
