/**
 * Фича `users` тестируется без соседа и без брокера.
 *
 * Собирается только `args: 'users'`. Владелец `notifications.check-address`
 * и подписчик `users.registered` подменены стабами операций, а внешний
 * клиент шины заменён `testApp.emit`. Код фичи тот же, что в
 * `split.spec.ts`.
 */

import { app } from './app.js';
import {
  AddressRejected,
  CheckAddress,
  RegisterUser,
  UserRegistered,
} from './operations.js';
import { db } from './persistence.js';
import { inbox, outbox, users } from './schema.js';
import { describeWithDatabase, testConfig, waitFor } from './testing.js';
import { CHECK_OPTIONS, TOPOLOGIES } from './topologies.js';

import { expect, it } from '@jest/globals';
import { makeApp } from '@nestlingjs/app';
import { OutboxRelay$ } from '@nestlingjs/outbox';
import type { TestApp } from '@nestlingjs/testing';
import { buildTest, checkTopologies, stub } from '@nestlingjs/testing';
import { http } from '@nestlingjs/transport.http';

/**
 * Декларация для изоляции: те же фичи и плагины, но без шины.
 *
 * `http()` остаётся: пробы и метрики объявлены HTTP-endpoint'ами, и без
 * их транспорта сборка остановилась бы на BUILD. Брокера нет,
 * соединение с ним не открывается, а соседние операции подменяются
 * стабами.
 */
const isolated = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  switches: app.spec.switches,
  policies: app.spec.policies,
  transports: [http()],
});

/** Убирает данные прошлого теста: соединение берётся из собранного графа */
async function clean(testApp: TestApp): Promise<void> {
  const connection = testApp.get(db.connection);

  if (!connection) {
    throw new Error('в графе нет соединения с базой');
  }

  await connection.db.delete(outbox);
  await connection.db.delete(inbox);
  await connection.db.delete(users);
}

describeWithDatabase('фича users в изоляции', () => {
  it('регистрирует пользователя через стабы соседних операций', async () => {
    const checked: { email: string }[] = [];
    const registered: { id: string; email: string }[] = [];

    await using testApp = await buildTest(isolated, {
      args: 'users',
      config: testConfig,
      // Ни владельца `notifications.check-address`, ни подписчика
      // `users.registered` в сборке нет: обе стороны заменены стабами
      stubs: [
        stub(CheckAddress, async (input) => {
          checked.push(input);

          return { deliverable: true };
        }),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });
    await clean(testApp);

    const [{ subscriber, response }] = await testApp.emit(RegisterUser, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(subscriber).toBe('users.register');
    expect(response.isSuccess).toBe(true);
    expect(checked).toEqual([{ email: 'alice@example.com' }]);

    // Событие транзакционное: во время запроса оно легло в хранилище, а в
    // шину уходит проходом relay
    expect(registered).toEqual([]);
    expect(await testApp.get(OutboxRelay$)?.drain()).toMatchObject({
      claimed: 1,
      published: 1,
    });

    // Подписчик разбирает тему отдельной задачей: тест ждёт следствие, а
    // не фиксированное время
    await waitFor(() => registered.length === 1, 'факт регистрации');
    expect(registered).toEqual([
      { id: expect.any(String), name: 'Alice', email: 'alice@example.com' },
    ]);
  });

  it('не публикует факт регистрации, когда адрес отвергнут', async () => {
    const registered: unknown[] = [];

    await using testApp = await buildTest(isolated, {
      args: 'users',
      config: testConfig,
      stubs: [
        // Отказ объявлен в `errors:` операции, поэтому стаб отдаёт его как
        // есть, так же, как настоящий владелец по сети
        stub(CheckAddress, async () =>
          AddressRejected({ email: 'bob@example.com', reason: 'bounced' }),
        ),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });
    await clean(testApp);

    await testApp.emit(RegisterUser, {
      name: 'Bob',
      email: 'bob@example.com',
    });

    expect(await testApp.get(OutboxRelay$)?.drain()).toMatchObject({
      claimed: 0,
    });
    expect(registered).toEqual([]);
  });

  it('каждая застабанная операция реализована в одной из топологий', async () => {
    await using testApp = await buildTest(isolated, {
      args: 'users',
      config: testConfig,
      stubs: [
        stub(CheckAddress, async () => ({ deliverable: true })),
        // Подписчик события ничего не возвращает: у события нет `output`
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stub(UserRegistered, () => {}),
      ],
    });

    // Матрица проверяет граф без подстановок: стаб операции, которой не
    // реализует ни одна топология, здесь станет виден
    const topologies = await checkTopologies(
      app,
      [...TOPOLOGIES],
      CHECK_OPTIONS,
    );

    const published = new Set(
      topologies.flatMap(({ report }) =>
        report.operations.map(({ name }) => name),
      ),
    );

    expect(testApp.stubbed.filter((name) => !published.has(name))).toEqual([]);
    expect(testApp.stubbed).toEqual([
      'notifications.check-address',
      'users.registered',
    ]);
  });
});
