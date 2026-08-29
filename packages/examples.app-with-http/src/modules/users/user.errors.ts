import { defineFail } from '@nestling/contracts';
import { z } from 'zod';

/**
 * Доменные отказы модуля пользователей.
 *
 * Отказ — значение: `defineFail` даёт конструктор, стабильный машинный
 * `code` и предикат `.is()`. Идентичность строится на коде, а не на
 * `instanceof`: тот же отказ остаётся узнаваемым и после передачи по сети.
 *
 * Определение ничего не регистрирует. На ответ endpoint'а оно влияет
 * только через `errors:` его декларации. Всё, что дошло до границы
 * пайплайна незадекларированным, проверка на соответствие списку
 * `errors` превращает в `UNKNOWN`/500.
 */

export const UserNotFound = defineFail('USER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/**
 * Статус `CONFLICT`, а не `BAD_REQUEST`: занятый email — конфликт с уже
 * существующими данными, а не ошибка формата запроса.
 */
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const NothingToUpdate = defineFail('NOTHING_TO_UPDATE', {
  status: 'BAD_REQUEST',
  message: 'No data to update',
});

export const UserNotDeletable = defineFail('USER_NOT_DELETABLE', {
  status: 'FORBIDDEN',
  details: z.object({ id: z.string(), reason: z.string() }),
  message: (d) => `User ${d.id} cannot be deleted: ${d.reason}`,
});

export const InvalidAvatar = defineFail('INVALID_AVATAR', {
  status: 'BAD_REQUEST',
  details: z.object({ reason: z.string() }),
  message: (d) => `Invalid avatar: ${d.reason}`,
});

export const SearchQueryRequired = defineFail('SEARCH_QUERY_REQUIRED', {
  status: 'BAD_REQUEST',
  message: 'Query parameter is required',
});

export const InvalidSignature = defineFail('INVALID_SIGNATURE', {
  status: 'UNAUTHORIZED',
  message: 'Invalid webhook signature',
});
