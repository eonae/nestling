/**
 * App-тесты: каждый запрос проходит полный пайплайн, сокет не открывается.
 */

import { CreateUser, DeleteUser, GetUser, ListUsers } from './users/endpoints';
import { UsersRepository$ } from './users/users.repository';
import { appSpec } from './app';
import type { Logger } from './logging';
import { Logger$ } from './logging';
import { inMemoryUsersRepo } from './testing';

import { describe, expect, it } from '@jest/globals';
import { assembleTest, unwrap, vars } from '@nestling/testing';
import { http } from '@nestling/transport.http';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };
const bob = { id: '2', name: 'Bob', email: 'bob@example.com' };

/** Тот же словарь, что в `main.ts`: порт `0` и конфиг из объекта вместо `process.env` */
const spec = {
  ...appSpec,
  transports: [http({ port: 0 })],
  config: vars({ API_TOKEN: 'test-token' }),
};

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
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual(alice);
    expect(unwrap(await app.call(ListUsers, {}))).toHaveLength(2);
  });

  it('возвращает объявленный отказ со статусом и кодом', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice])]],
    });

    expect(await app.call(GetUser, { id: '404' })).toMatchObject({
      isSuccess: false,
      status: 'not_found',
      value: { code: 'USER_NOT_FOUND', details: { id: '404' } },
    });
  });

  it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    // Соединение с базой нужно только боевому хранилищу: после подмены
    // контейнер его не создаёт, и `@OnInit` не вызывается
    expect(app.pruned).toContain('Database');
  });

  it('читает размер страницы из конфига', async () => {
    await using app = await assembleTest({
      ...spec,
      config: vars({ API_TOKEN: 'test-token', APP_PAGE_SIZE: '1' }),
      overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
    });

    expect(unwrap(await app.call(ListUsers, {}))).toEqual([alice]);
  });

  it('отклоняет запись без токена до вызова хендлера', async () => {
    const repo = inMemoryUsersRepo([alice]);
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, repo]],
    });

    expect(await app.call(DeleteUser, { id: '1' })).toMatchObject({
      isSuccess: false,
      status: 'unauthorized',
      value: { code: 'unauthorized' },
    });
    expect(await repo.byId('1')).toEqual(alice);
  });

  it('создаёт пользователя по токену из конфига', async () => {
    await using app = await assembleTest({
      ...spec,
      overrides: [[UsersRepository$, inMemoryUsersRepo()]],
    });

    const created = await app.call(
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

  it('пишет строку аудита с идентификатором запроса', async () => {
    const spy = spyLogger();
    await using app = await assembleTest({
      ...spec,
      overrides: [
        [UsersRepository$, inMemoryUsersRepo([alice])],
        [Logger$, spy.logger],
      ],
    });

    unwrap(await app.call(GetUser, { id: '1' }));

    expect(spy.lines).toContainEqual(
      expect.stringMatching(/^\[[^\]]+] GET \/users\/:id OK \(completed\)$/),
    );
  });
});
