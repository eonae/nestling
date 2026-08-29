/**
 * Публичные контракты HTTP-API: их импортирует внешний потребитель.
 *
 * Импорты файла не ведут к серверному коду: только `@nestling/contracts`,
 * `zod` и доменные отказы (тоже объявлены через `@nestling/contracts`).
 * Поэтому контракты можно импортировать во фронтенд: клиент
 * `api.client.ts` берёт отсюда адрес, схемы и список отказов.
 *
 * Секция `http:` описывает адрес, а не исполнение. Реализация живёт рядом
 * с фичей и подключает контракт через `httpEndpoint({ contract })`, так
 * что адрес и endpoint не могут разойтись.
 */

import { EmailTaken, UserNotFound } from './modules/users/user.errors';
import { QuotaExceeded } from './contracts';

import { makeContract, query } from '@nestling/contracts';
import { z } from 'zod';

/** Пользователь в ответе API; одна схема для всех операций */
export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),

  /**
   * Флаг «только проверка». По правилу размещения поле POST ушло бы в
   * тело; пометка `query()` в контракте ниже переносит его в query-строку.
   *
   * Схема описывает то, что приходит по сети: query несёт строки, и
   * клиент пишет туда `String(value)`. `z.stringbool()` принимает
   * `'true'`, `'false'`, `'1'`, `'0'`; `z.boolean()` отверг бы
   * `?dryRun=true`.
   */
  dryRun: z.stringbool().optional(),
});

/**
 * Создание пользователя.
 *
 * `errors:` объявляет и свой отказ (`EmailTaken`), и отказ соседней фичи
 * (`QuotaExceeded`), который endpoint возвращает как есть: внешний
 * потребитель должен знать те же отказы, что и сам endpoint.
 */
export const CreateUser = makeContract({
  name: 'api.users.create',
  kind: 'request',
  http: { method: 'POST', path: '/api/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded],
  // Документация — часть контракта, а не реализации: endpoint получает
  // её вместе со схемами. Статус назван явно, потому что хендлер
  // отвечает `Ok.created(...)`
  doc: {
    summary: 'Создать пользователя',
    description:
      'Занимает квоту у соседней фичи и публикует событие регистрации. ' +
      '`?dryRun=true` — только проверка, без записи.',
    tags: ['users'],
    status: 'CREATED',
  },
});

/** Чтение пользователя по идентификатору */
export const GetUser = makeContract({
  name: 'api.users.get',
  kind: 'request',
  http: 'GET /api/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'Прочитать пользователя по идентификатору', tags: ['users'] },
});
