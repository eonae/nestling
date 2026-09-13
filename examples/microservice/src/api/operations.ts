/**
 * Публичные операции HTTP-API. Их импортирует и сервер, и клиент.
 *
 * Файл тянет только `@nestlingjs/operations`, `zod` и определения отказов,
 * поэтому его можно импортировать во фронтенд. Секция `http:` описывает
 * адрес; реализация подключает операцию через `httpEndpoint.implement`.
 */

import { Unauthorized } from '../errors.js';
import { CreateUserInput, User } from '../users/user.js';
import { EmailTaken, UserNotFound } from '../users/users.errors.js';

import { body, makeRequest, query } from '@nestlingjs/operations';
import { z } from 'zod';

// Схемы и отказы уезжают вместе с операциями: потребитель API импортирует
// один файл
export { CreateUserInput, User } from '../users/user.js';
export { EmailTaken, UserNotFound } from '../users/users.errors.js';
export { Unauthorized } from '../errors.js';

// GET без тела: поля `input` читаются из query-строки. Query несёт строки,
// число из них делает схема
export const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export type ListUsersInput = z.infer<typeof ListUsersInput>;

export const ListUsers = makeRequest({
  name: 'users.list',
  http: 'GET /users',
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
});

/**
 * Адрес выгрузки.
 *
 * Константой, а не операцией: выгрузка отдаёт поток NDJSON и заголовок с
 * именем файла, а типизированный клиент строится только над операциями,
 * вход и выход которых — значения. Адрес назван здесь один раз, и его
 * читают и сервер, и тот, кто выгрузку скачивает.
 */
export const EXPORT_USERS_PATH = '/users/export';

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
