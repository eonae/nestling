/* eslint-disable no-console --
 * скрипт-потребитель печатает результат: это его единственный вывод */
/**
 * Внешний потребитель API.
 *
 * Скрипт импортирует ровно два пакета: операции приложения и
 * `@nestling/client`. Контейнер, пайплайн и транспорт сюда не попадают:
 * импорты `@nestling/contracts` не ведут к серверному коду, и это
 * проверяет тест границы пакета.
 *
 * Запуск (сервер должен быть поднят `yarn start`):
 * ```
 * yarn workspace examples.app-with-http exec tsx src/api.client.ts
 * ```
 */

import { EmailTaken, UserNotFound } from './modules/users/user.errors';
import { CreateUser, GetUser } from './api.contracts';
import { QuotaExceeded } from './contracts';

import { makeClient } from '@nestling/client';

/**
 * Клиент API. Имена методов задаёт потребитель — ключами объекта.
 *
 * `headers` — функция, а не объект: заголовки вычисляются на каждый
 * запрос, поэтому ротация токена не требует пересоздавать клиент.
 */
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    headers: () => ({ 'x-request-source': 'example-client' }),
  },
);

async function main(): Promise<void> {
  // Вызов устроен так же, как вызов порта: ответ — `Ok | Fail`, и его
  // разбирает вызывающий
  const created = await api.createUser({
    name: 'Alice',
    email: `alice-${Date.now().toString()}@example.com`,
  });

  if (EmailTaken.is(created)) {
    // Клиент восстановил `Fail` из ответа по коду: `details` типизированы
    // схемой определения. `instanceof` здесь не работает: после
    // сериализации класса нет
    console.log(`email taken: ${created.details.email}`);
    return;
  }

  if (QuotaExceeded.is(created)) {
    console.log(`quota exhausted, limit ${created.details.limit.toString()}`);
    return;
  }

  if (created.isFail) {
    // Любой незадекларированный отказ приходит как `UnknownError`:
    // множество ответов клиента то же, что на выходе из пайплайна
    console.log(`unexpected failure: ${created.message}`);
    return;
  }

  console.log(`created ${created.value.id} (${created.value.email})`);

  // Path-параметр подставляется по той же карте размещения, по которой
  // транспорт разбирает запрос
  const fetched = await api.getUser({ id: created.value.id });

  if (UserNotFound.is(fetched)) {
    console.log(`user ${fetched.details.id} disappeared`);
    return;
  }

  if (fetched.isFail) {
    console.log(`unexpected failure: ${fetched.message}`);
    return;
  }

  console.log(`fetched ${fetched.value.name}`);
}

await main();
