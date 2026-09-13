/**
 * Внешний потребитель API: скрипт, который создаёт и читает пользователя.
 *
 * Импортирует операции и `@nestlingjs/client`. Контейнер, пайплайн и
 * транспорт сюда не попадают.
 *
 * Запуск при поднятом сервере:
 * `API_TOKEN=secret yarn workspace @examples/microservice client`
 */

import { EmailTaken, UserNotFound } from '../users/users.errors.js';

import { CreateUser, GetUser } from './operations.js';

import { makeConsoleLogger } from '@nestlingjs/app';
import { makeClient } from '@nestlingjs/client';

/**
 * Логгер скрипта: та же фабрика, что даёт умолчание корня.
 *
 * Приложение сюда не импортируется, поэтому ни контейнера, ни его логгера
 * здесь нет — а формат строки остаётся тем же, что у сервиса.
 */
const logger = makeConsoleLogger();

/** Имена методов задаёт потребитель: ключи объекта */
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    // Функция, а не объект: заголовки вычисляются на каждый запрос
    headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ''}` }),
  },
);

async function main(): Promise<void> {
  const created = await api.createUser({
    name: 'Carol',
    email: `carol-${Date.now().toString()}@example.com`,
  });

  // Ответ — `Ok | Fail`; отказ узнаётся по коду, `instanceof` после
  // сериализации не работает
  if (EmailTaken.is(created)) {
    logger.warn('email taken', { email: created.details.email });
    return;
  }

  if (created.isFail) {
    logger.error('request failed', {
      code: created.code,
      reason: created.message,
    });
    return;
  }

  logger.info('user created', { id: created.value.id });

  const fetched = await api.getUser({ id: created.value.id });

  if (UserNotFound.is(fetched)) {
    logger.warn('user disappeared', { id: fetched.details.id });
    return;
  }

  if (fetched.isFail) {
    logger.error('request failed', {
      code: fetched.code,
      reason: fetched.message,
    });
    return;
  }

  logger.info('user fetched', { name: fetched.value.name });
}

await main();
