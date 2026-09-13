/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 *
 * Тест собирает ту же декларацию, что `main.ts`: `buildTest(app, …)`
 * принимает подмены, выбор фич и конфиг теста.
 *
 * Приложению нужна настоящая база: пул открывается на фазе INIT, а слой
 * транзакции и хранилище пишут SQL. Адрес приходит переменной
 * `TEST_DATABASE_URL`; без неё прогон пропускается, и `yarn verify` на
 * машине без базы остаётся зелёным. База поднимается локально
 * `yarn db:up` и мигрируется `yarn db:migrate`; CI поднимает её сервисом.
 *
 * Имя переменной своё, а не `DATABASE_URL`: прогон тестов не должен
 * зависеть от того, что лежит в окружении под именем боевого ключа.
 */

import {
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './users/endpoints/index.js';
import { UsersRepository$ } from './users/users.repository.js';
import { app } from './app.js';
import { db } from './persistence.js';
import { users } from './schema.js';
import { inMemoryUsersRepo } from './testing.js';

import { describe, expect, it } from '@jest/globals';
import { bind, RootLogger$ } from '@nestlingjs/app';
import type { TestApp } from '@nestlingjs/testing';
import { buildTest, spyLogger, unwrap, vars } from '@nestlingjs/testing';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Адрес базы; без него весь набор пропускается */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe`, который молчит без базы */
const describeWithDatabase: (title: string, suite: () => void) => void =
  TEST_DATABASE_URL ? describe : describe.skip;

/** Конфиг теста: объект вместо `process.env` */
const testConfig = [
  bind(
    vars({
      API_TOKEN: 'test-token',
      WEBHOOK_SECRET: 'test-hook',
      DATABASE_URL: TEST_DATABASE_URL ?? '',
    }),
  ),
];

/**
 * Убирает данные прошлого теста и кладёт нужные этому.
 *
 * Соединение берётся из собранного графа: это то же соединение, которым
 * работают endpoint'ы, поэтому засев виден им без отдельного пула.
 */
async function seed(
  testApp: TestApp,
  rows: readonly (typeof users.$inferInsert)[] = [],
): Promise<void> {
  const connection = testApp.get(db.connection);

  if (!connection) {
    throw new Error('в графе нет соединения с базой');
  }

  await connection.db.delete(users);

  if (rows.length > 0) {
    await connection.db.insert(users).values([...rows]);
  }
}

describeWithDatabase('microservice', () => {
  it('отдаёт пользователя через полный пайплайн', async () => {
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
    expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
  });

  it('возвращает объявленный отказ с категорией и кодом', async () => {
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice])]],
    });

    expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
      isSuccess: false,
      status: 'not_found',
      value: { code: 'not_found:user', details: { id: '404' } },
    });
  });

  it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    // Логгер и ридер контекста нужны только боевому хранилищу: после
    // подмены контейнер их не создаёт. Соединение с базой в списке не
    // окажется — его держит слой транзакции
    expect(testApp.pruned).toContain('Logger:DbUsersRepository');
    expect(testApp.pruned).toContain('Ctx:requestId');
  });

  it('читает размер страницы из конфига', async () => {
    await using testApp = await buildTest(app, {
      config: [
        bind(
          vars({
            API_TOKEN: 'test-token',
            WEBHOOK_SECRET: 'test-hook',
            APP_PAGE_SIZE: '1',
            DATABASE_URL: TEST_DATABASE_URL ?? '',
          }),
        ),
      ],
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
  });

  it('отклоняет запись без Bearer-токена до вызова хендлера', async () => {
    const repo = inMemoryUsersRepo([alice]);
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, repo]],
    });

    expect(await testApp.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'unauthorized',
      value: { code: 'unauthorized' },
    });
    expect(await repo.byId('1')).toEqual(alice);
  });

  it('создаёт пользователя по Bearer-токену из конфига', async () => {
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const created = await testApp.call(
      CreateUser,
      { name: 'Carol', email: 'carol@example.com' },
      { attributes: { authorization: 'Bearer test-token' } },
    );

    expect(created).toMatchObject({
      isSuccess: true,
      status: 'created',
      value: { name: 'Carol' },
    });
  });

  it('откатывает транзакцию, когда слой ответил отказом', async () => {
    await using testApp = await buildTest(app, { config: testConfig });
    await seed(testApp);

    // Bearer-токен не тот: слой `authed` отвечает отказом, слой транзакции
    // откатывает её, и до хендлера дело не доходит
    const rejected = await testApp.call(
      CreateUser,
      { name: 'Carol', email: 'carol@example.com' },
      { attributes: { authorization: 'Bearer wrong' } },
    );

    expect(rejected.isSuccess).toBe(false);

    const connection = testApp.get(db.connection);

    if (!connection) {
      throw new Error('в графе нет соединения с базой');
    }

    expect(await connection.db.select().from(users)).toEqual([]);
  });

  it('пишет запись аудита через логгер ядра', async () => {
    // Подмена корня перехватывает записи всех токенов семейства Logger$: и ядра, и
    // приложения. Область записи — имя класса, взявшего Logger$.auto
    const spy = spyLogger();
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo([alice])],
        [RootLogger$, spy.logger],
      ],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    // Поле `requestId` в записи — поле корреляции: его подмешивает ядро,
    // и шпион получает его так же, как штатный логгер
    expect(spy.entries).toContainEqual({
      level: 'info',
      message: 'GET /users/:id ok',
      fields: {
        scope: 'AuditOutcome',
        outcome: 'completed',
        requestId: expect.any(String),
      },
    });
  });

  it('хранилище пишет идентификатор запроса полем записи', async () => {
    const spy = spyLogger();
    await using testApp = await buildTest(app, {
      config: testConfig,
      overrides: [[RootLogger$, spy.logger]],
    });
    await seed(testApp, [alice]);

    unwrap(await testApp.call(GetUser, { id: '1' }));

    // Endpoint вызван без requestId, и параметром он в хранилище не
    // передан: значение прочитано из контекста запроса
    expect(spy.entries).toContainEqual({
      level: 'debug',
      message: 'byId 1',
      fields: { scope: 'DbUsersRepository', requestId: expect.any(String) },
    });
    expect(spy.entries).not.toContainEqual(
      expect.objectContaining({
        fields: expect.objectContaining({ requestId: 'n/a' }),
      }),
    );
  });
});
