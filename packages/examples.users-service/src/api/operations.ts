/**
 * Публичные операции HTTP-API. Их импортирует и сервер, и клиент.
 *
 * Файл тянет только `@nestling/operations`, `zod` и определения отказов,
 * поэтому его можно импортировать во фронтенд. Секция `http:` описывает
 * адрес; реализация подключает операцию через `httpEndpoint({ operation })`.
 */

import { Unauthorized } from '../errors';
import { CreateUserInput, User } from '../users/user';
import { EmailTaken, UserNotFound } from '../users/users.errors';

import { body, makeRequest, query } from '@nestling/operations';
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

/**
 * `errors:` перечисляет и отказ хендлера (`EmailTaken`), и отказ слоя
 * `authed` (`Unauthorized`): клиент должен знать те же отказы, что
 * получает от сервера.
 *
 * `bind` говорит, откуда транспорт читает поле: `dryRun` из query-строки
 * (`POST /users?dryRun=true`), `name` и `email` из тела. Без пометки поле
 * POST-запроса читается из тела, поэтому `body()` у `name` — запись того
 * же умолчания вслух.
 */
export const CreateUser = makeRequest({
  name: 'users.create',
  http: {
    method: 'POST',
    path: '/users',
    bind: { dryRun: query(), name: body() },
  },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, Unauthorized],
  // Статус успеха назван явно: хендлер отвечает `Ok.created(...)`
  doc: { summary: 'Создать пользователя', tags: ['users'], status: 'created' },
});
