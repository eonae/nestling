/* eslint-disable no-console --
 * скрипт-потребитель печатает результат: это его единственный вывод */
/**
 * Внешний потребитель API — то, ради чего заводились контракты-значения.
 *
 * Импортируется **ровно два** пакета: контракты приложения и
 * `@nestling/client`. Ни контейнера, ни pipeline, ни транспорта здесь нет —
 * и не появится: граф импортов `@nestling/contracts` до серверного кода не
 * доходит, и это проверяется тестом границы пакета, а не обещанием.
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
 * Методы именует потребитель — ключами записи.
 *
 * `headers` задан функцией, а не записью: токен ротируется, и статическая
 * запись защёлкнула бы его на момент создания клиента.
 */
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    headers: () => ({ 'x-request-source': 'example-client' }),
  },
);

async function main(): Promise<void> {
  // Call-site эквивалентен вызывателю порта: `Ok | Fail`, и та же
  // ветвящаяся логика работает без правок
  const created = await api.createUser({
    name: 'Alice',
    email: `alice-${Date.now().toString()}@example.com`,
  });

  if (EmailTaken.is(created)) {
    // Отказ рематериализован по коду: `details` типизированы схемой
    // определения, `instanceof` тут ни при чём — по проводу класс мёртв
    console.log(`email taken: ${created.details.email}`);
    return;
  }

  if (QuotaExceeded.is(created)) {
    console.log(`quota exhausted, limit ${created.details.limit.toString()}`);
    return;
  }

  if (created.isFail) {
    // Всё незадекларированное закрыто одним кодом — множество ответов
    // `E ∪ UnknownError` замкнуто так же, как на серверной границе
    console.log(`unexpected failure: ${created.message}`);
    return;
  }

  console.log(`created ${created.value.id} (${created.value.email})`);

  // Path-параметр подставляется по bind-карте контракта — той же, по
  // которой транспорт разберёт запрос
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
