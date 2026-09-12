/**
 * Фикстура: результат хендлера компилятору неизвестен.
 *
 * Переменная объявлена типом `HandlerFn`, поэтому возвращаемые отказы из
 * неё не выводятся и проверка откатывается на ограничение слота. Отсечка
 * по `FailCode` делает бренд пустым: декларация компилируется, а
 * незаявленный отказ остаётся на проверке границы в рантайме.
 */

import { EmailTaken, User, UserInput } from '../support/fixture-kit.js';

import type { AnyInput, HandlerFn } from '@nestlingjs/app';
import type { AnyFail } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';

declare const opaque: HandlerFn<
  typeof UserInput,
  typeof User,
  AnyInput,
  AnyFail
>;

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: UserInput,
  output: User,
  errors: [EmailTaken],
  handler: opaque,
});
