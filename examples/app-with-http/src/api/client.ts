/* eslint-disable no-console -- скрипт печатает результат вызовов */
/**
 * Внешний потребитель API: скрипт, который создаёт и читает пользователя.
 *
 * Импортирует операции и `@nestling/client`. Контейнер, пайплайн и
 * транспорт сюда не попадают.
 *
 * Запуск при поднятом сервере:
 * `API_TOKEN=secret yarn workspace @examples/app-with-http client`
 */

import { EmailTaken, UserNotFound } from '../features/users/users.errors.js';
import { QuotaExceeded } from '../operations.js';

import { CreateUser, GetUser } from './operations.js';

import { makeClient } from '@nestling/client';

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
    console.log(`email taken: ${created.details.email}`);
    return;
  }

  // Отказ соседней фичи доходит до внешнего клиента с теми же деталями
  if (QuotaExceeded.is(created)) {
    console.log(`quota exhausted, limit ${created.details.limit.toString()}`);
    return;
  }

  if (created.isFail) {
    console.log(`request failed: ${created.code} ${created.message}`);
    return;
  }

  console.log(`created ${created.value.id}`);

  const fetched = await api.getUser({ id: created.value.id });

  if (UserNotFound.is(fetched)) {
    console.log(`user ${fetched.details.id} disappeared`);
    return;
  }

  if (fetched.isFail) {
    console.log(`request failed: ${fetched.code} ${fetched.message}`);
    return;
  }

  console.log(`fetched ${fetched.value.name}`);
}

await main();
