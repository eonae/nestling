/**
 * Публичные контракты HTTP-API — то, что импортирует **внешний**
 * потребитель.
 *
 * Файл собран так, чтобы его граф импортов не доходил до сервера: только
 * `@nestling/contracts`, `zod` и доменные отказы (они тоже объявлены через
 * `@nestling/contracts`). Именно это делает контракт импортируемым во
 * фронт: клиентский скрипт `api.client.ts` берёт отсюда всё — адрес, схемы,
 * множество отказов — и больше ниоткуда.
 *
 * Секция `http:` — данные адресации, а не описание исполнения. Реализация
 * живёт рядом с фичей и подключается контракт-формой `httpEndpoint`, так что
 * разъехаться адресу и ручке негде.
 */

import { EmailTaken, UserNotFound } from './modules/users/user.errors';
import { QuotaExceeded } from './contracts';

import { makeContract, query } from '@nestling/contracts';
import { z } from 'zod';

/** Пользователь на проводе — один и тот же в обе стороны */
export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),

  /**
   * Поле-флаг: по канону POST оно уехало бы в тело, пометка `query()`
   * ниже переносит его в query-строку.
   *
   * Схема обязана понимать **проводную** форму: query несёт строки, и
   * клиент пишет туда `String(value)`. `z.stringbool()` понимает
   * `'true'`/`'false'`/`'1'`/`'0'`; `z.boolean()` отверг бы законный
   * `?dryRun=true` — и это не дефект клиента, а свойство провода.
   */
  dryRun: z.stringbool().optional(),
});

/**
 * Создание пользователя.
 *
 * `errors:` объявляет и свой отказ (`EmailTaken`), и отказ соседней фичи
 * (`QuotaExceeded`), который ручка пробрасывает: множество ответов у
 * внешнего потребителя обязано быть тем же, что у ручки.
 */
export const CreateUser = makeContract({
  name: 'api.users.create',
  kind: 'request',
  http: { method: 'POST', path: '/api/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded],
  // Документация — часть интерфейса операции, а не её реализации: она
  // объявлена здесь и приезжает на декларацию вместе со схемами. Статус
  // назван явно, потому что хендлер отвечает `Ok.created(...)`
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
