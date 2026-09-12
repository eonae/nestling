/**
 * Фикстура: функция-хендлер возвращает только объявленные отказы.
 *
 * Закрепляет причину, по которой проверка отказов у этой формы стоит в
 * возвращаемом типе, а не в слоте. Проверка в слоте видела бы всё
 * множество отказов вместо возвращённого и отвергала бы этот файл.
 */

import { EmailTaken, User } from '../support/fixture-kit.js';

import { Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  output: User,
  errors: [EmailTaken],
  handler: async () =>
    Math.random() > 0.5 ? EmailTaken() : new Ok({ id: 'u-1', email: 'a@b.c' }),
});
