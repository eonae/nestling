/**
 * Публичные операции HTTP-API. Их импортирует и сервер, и клиент.
 *
 * Файл тянет только `@nestling/operations`, `zod` и определения отказов,
 * поэтому его можно импортировать во фронтенд. Секция `http:` описывает
 * адрес; реализация подключает операцию через `httpEndpoint({ operation })`.
 */

import { Unauthorized } from '../errors';
import { NewUser, User } from '../features/users/user';
import { EmailTaken, UserNotFound } from '../features/users/users.errors';
import { QuotaExceeded } from '../operations';

import { makeRequest, query } from '@nestling/operations';
import { z } from 'zod';

export const GetUserInput = z.object({ id: z.string() });

export type GetUserInput = z.infer<typeof GetUserInput>;

export const GetUser = makeRequest({
  name: 'users.get',
  http: 'GET /users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'Пользователь по идентификатору', tags: ['users'] },
});

export const CreateUserInput = NewUser.extend({
  // Query несёт строки, поэтому `z.stringbool()`: он принимает `'true'`
  // и `'false'`, а `z.boolean()` отверг бы `?dryRun=true`
  dryRun: z.stringbool().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;

/**
 * `errors:` перечисляет отказ хендлера, отказ соседней фичи и отказ слоя
 * `authed`: клиент должен знать те же отказы, что получает от сервера.
 *
 * По правилу размещения поле POST уходит в тело; `bind` переносит
 * `dryRun` в query-строку, и клиент собирает запрос по той же карте.
 */
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded, Unauthorized],
  doc: {
    summary: 'Создать пользователя',
    description: '`?dryRun=true` проверяет данные без записи.',
    tags: ['users'],
    status: 'created',
  },
});
