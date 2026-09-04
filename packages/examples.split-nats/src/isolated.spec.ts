/**
 * Фича `users` тестируется без соседа и без брокера.
 *
 * Собирается только `select: 'users'`. Владелец `quotas.claim` и
 * подписчик `users.registered` подменены стабами операций, а внешний
 * клиент шины заменён `app.emit`. Код фичи тот же, что в `split.spec.ts`.
 */

import { app } from './app.js';
import {
  ClaimQuota,
  QuotaExceeded,
  RegisterUser,
  UserRegistered,
} from './operations.js';
import { QuotasFeature } from './quotas.js';
import { UsersFeature } from './users.js';

import { describe, expect, it } from '@jest/globals';
import { makeApp } from '@nestling/app';
import { assembleTest, checkTopologies, stub } from '@nestling/testing';

/**
 * Декларация для изоляции: те же фичи без шины. Соседние операции
 * подменяются стабами, поэтому брокер тесту не нужен, а соединение с ним
 * не открывается
 */
const isolated = makeApp({ features: [UsersFeature, QuotasFeature] });

describe('фича users в изоляции', () => {
  it('регистрирует пользователя через стабы соседних операций', async () => {
    const claimed: { email: string }[] = [];
    const registered: { id: string; email: string }[] = [];

    await using testApp = await assembleTest(isolated, {
      select: 'users',
      // Ни владельца `quotas.claim`, ни подписчика `users.registered` в
      // сборке нет: обе стороны заменены стабами
      stubs: [
        stub(ClaimQuota, async (input) => {
          claimed.push(input);

          return { remaining: 1 };
        }),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });

    const [{ subscriber, response }] = await testApp.emit(RegisterUser, {
      email: 'alice@example.com',
    });

    expect(subscriber).toBe('users.register');
    expect(response.isSuccess).toBe(true);
    expect(claimed).toEqual([{ email: 'alice@example.com' }]);
    expect(registered).toEqual([
      { id: expect.any(String), email: 'alice@example.com' },
    ]);
  });

  it('не публикует факт регистрации при исчерпанной квоте', async () => {
    const registered: unknown[] = [];

    await using testApp = await assembleTest(isolated, {
      select: 'users',
      stubs: [
        // Отказ объявлен в `errors:` операции, поэтому стаб отдаёт его как
        // есть, так же, как настоящий владелец по сети
        stub(ClaimQuota, async () => QuotaExceeded({ limit: 100 })),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });

    await testApp.emit(RegisterUser, { email: 'bob@example.com' });

    expect(registered).toEqual([]);
  });

  it('каждая застабанная операция реализована в одной из топологий', async () => {
    await using testApp = await assembleTest(isolated, {
      select: 'users',
      stubs: [
        stub(ClaimQuota, async () => ({ remaining: 1 })),
        // Подписчик события ничего не возвращает: у события нет `output`
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stub(UserRegistered, () => {}),
      ],
    });

    // Матрица проверяет граф без подстановок: стаб операции, которой не
    // реализует ни одна топология, здесь станет виден
    const topologies = await checkTopologies(app, ['all', 'users', 'quotas']);

    const published = new Set(
      topologies.flatMap(({ report }) =>
        report.operations.map(({ name }) => name),
      ),
    );

    expect(testApp.stubbed.filter((name) => !published.has(name))).toEqual([]);
    expect(testApp.stubbed).toEqual(['quotas.claim', 'users.registered']);
  });
});
