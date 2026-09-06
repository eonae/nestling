/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 *
 * Тест собирает ту же декларацию, что `main.ts`: `assembleTest(app, …)`
 * принимает подмены, выбор фич и конфиг теста.
 */

import {
  CreateUser,
  DeleteUser,
  GetUser,
  ListUsers,
} from './users/endpoints/index.js';
import { UsersRepository$ } from './users/users.repository.js';
import { app } from './app.js';
import { inMemoryUsersRepo } from './testing.js';

import { describe, expect, it } from '@jest/globals';
import { RootLogger$ } from '@nestling/app';
import { assembleTest, spyLogger, unwrap, vars } from '@nestling/testing';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Конфиг теста: объект вместо `process.env` */
const testConfig = vars({ API_TOKEN: 'test-token' });

describe('users-service', () => {
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

    // Соединение с базой нужно только боевому хранилищу: после подмены
    // контейнер его не создаёт, и `acquire` не вызывается
    expect(testApp.pruned).toContain('Database');
  });

  it('читает размер страницы из конфига', async () => {
    await using testApp = await assembleTest(app, {
      config: vars({ API_TOKEN: 'test-token', APP_PAGE_SIZE: '1' }),
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
  });

  it('отклоняет запись без токена до вызова хендлера', async () => {
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

  it('создаёт пользователя по токену из конфига', async () => {
    await using testApp = await assembleTest(app, {
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
      headers: { Location: '/users/1' },
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
