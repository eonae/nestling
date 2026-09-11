/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 *
 * Тест собирает ту же декларацию, что `main.ts`: `assembleTest(app, …)`
 * принимает подмены, выбор фич и конфиг теста.
 *
 * Приложению нужна настоящая база: пул открывается на фазе INIT, а слой
 * транзакции и хранилище outbox'а пишут SQL. Адрес приходит переменной
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
import { outbox as outboxRecords, users } from './schema.js';
import { inMemoryUsersRepo } from './testing.js';

import { describe, expect, it } from '@jest/globals';
import { RootLogger$ } from '@nestlingjs/app';
import { OutboxRelay$ } from '@nestlingjs/outbox';
import type { TestApp } from '@nestlingjs/testing';
import { assembleTest, spyLogger, unwrap, vars } from '@nestlingjs/testing';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Адрес базы; без него весь набор пропускается */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe`, который молчит без базы */
const describeWithDatabase: (title: string, suite: () => void) => void =
  TEST_DATABASE_URL ? describe : describe.skip;

/** Конфиг теста: объект вместо `process.env` */
const testConfig = vars({
  API_TOKEN: 'test-token',
  DATABASE_URL: TEST_DATABASE_URL ?? '',
});

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

  await connection.db.delete(outboxRecords);
  await connection.db.delete(users);

  if (rows.length > 0) {
    await connection.db.insert(users).values([...rows]);
  }
}

describeWithDatabase('users-service', () => {
  it('отдаёт пользователя через полный пайплайн', async () => {
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
    expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
  });

  it('возвращает объявленный отказ с категорией и кодом', async () => {
    await using testApp = await assembleTest(app, {
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
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    // Логгер и ридер контекста нужны только боевому хранилищу: после
    // подмены контейнер их не создаёт. Соединение с базой в списке не
    // окажется — его делит хранилище outbox'а
    expect(testApp.pruned).toContain('Logger:DbUsersRepository');
    expect(testApp.pruned).toContain('Ctx:requestId');
  });

  it('читает размер страницы из конфига', async () => {
    await using testApp = await assembleTest(app, {
      config: vars({
        API_TOKEN: 'test-token',
        APP_PAGE_SIZE: '1',
        DATABASE_URL: TEST_DATABASE_URL ?? '',
      }),
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
  });

  it('отклоняет запись без Bearer-токена до вызова хендлера', async () => {
    const repo = inMemoryUsersRepo([alice]);
    await using testApp = await assembleTest(app, {
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
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });
    // Хранилище подменено, но запись outbox'а всё равно идёт в базу:
    // транзакционный emit пишет её той же транзакцией запроса
    await seed(testApp);

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

  it('кладёт событие в outbox и доставляет его проходом relay', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [[RootLogger$, spy.logger]],
    });
    await seed(testApp);

    await testApp.call(
      CreateUser,
      { name: 'Carol', email: 'carol@example.com' },
      { attributes: { authorization: 'Bearer test-token' } },
    );

    // Во время запроса в шину не ушло ничего: запись легла в хранилище
    expect(spy.entries).not.toContainEqual(
      expect.objectContaining({ message: 'welcome email sent' }),
    );

    // Тестовая сборка останавливается после WIRE, `@OnStart` не
    // выполняется — проход по партии делает сам тест
    const relay = testApp.get(OutboxRelay$);
    expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });

    expect(spy.entries).toContainEqual({
      level: 'info',
      message: 'welcome email sent',
      fields: {
        scope: 'WelcomeEmailHandler',
        // Идентификатор выдаёт хранилище, и он перестал быть счётчиком
        id: expect.any(String),
        email: 'carol@example.com',
      },
    });
  });

  it('откат транзакции убирает и пользователя, и запись outbox', async () => {
    await using testApp = await assembleTest(app, {
      config: testConfig,
    });
    await seed(testApp);

    // Bearer-токен не тот: слой `authed` отвечает отказом, слой транзакции
    // откатывает её, и до хендлера дело не доходит
    const rejected = await testApp.call(
      CreateUser,
      { name: 'Carol', email: 'carol@example.com' },
      { attributes: { authorization: 'Bearer wrong' } },
    );

    expect(rejected.isSuccess).toBe(false);
    expect(await testApp.get(OutboxRelay$)?.drain()).toMatchObject({
      claimed: 0,
    });
  });

  it('пишет запись аудита через логгер ядра', async () => {
    // Подмена корня перехватывает записи всех членов Logger$: и ядра, и
    // приложения. Область записи — имя класса, взявшего Logger$.auto
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo([alice])],
        [RootLogger$, spy.logger],
      ],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    expect(spy.entries).toContainEqual({
      level: 'info',
      message: 'GET /users/:id ok',
      fields: { scope: 'AuditOutcome', outcome: 'completed' },
    });
  });

  it('хранилище пишет идентификатор запроса полем записи', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
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
