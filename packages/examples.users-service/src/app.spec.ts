/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 *
 * Тест собирает ту же декларацию, что `main.ts`: `assembleTest(app, …)`
 * принимает подмены, выбор фич и конфиг теста.
 */

import { CreateUser, DeleteUser, GetUser, ListUsers } from './users/endpoints';
import { UsersRepository$ } from './users/users.repository';
import { app } from './app';
import type { Logger } from './logging';
import { Logger$ } from './logging';
import { inMemoryUsersRepo } from './testing';

import { describe, expect, it } from '@jest/globals';
import { assembleTest, unwrap, vars } from '@nestling/testing';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Конфиг теста: объект вместо `process.env` */
const testConfig = vars({ API_TOKEN: 'test-token' });

/** Логгер, который копит строки: по ним тест читает аудит */
const spyLogger = (): { lines: string[]; logger: Logger } => {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      log: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
  };
};

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
    // контейнер его не создаёт, и `@OnInit` не вызывается
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

  it('пишет строку аудита с идентификатором запроса', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      config: testConfig,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo([alice])],
        [Logger$, spy.logger],
      ],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    expect(spy.lines).toContainEqual(
      expect.stringMatching(/^\[[^\]]+] GET \/users\/:id ok \(completed\)$/),
    );
  });
});
