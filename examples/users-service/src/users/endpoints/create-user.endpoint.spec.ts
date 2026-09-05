/**
 * Юнит-тест хендлера: класс создаётся через `new` с фейком, без
 * контейнера и транспорта.
 */

import { inMemoryUsersRepo } from '../../testing.js';
import { EmailTaken } from '../users.errors.js';

import { CreateUserHandler } from './create-user.endpoint.js';

import { describe, expect, it } from '@jest/globals';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает created с заголовком Location', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
      headers: { Location: '/users/2' },
    });
  });

  it('возвращает отказ EmailTaken для занятого email', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

    const result = await handler.handle({
      name: 'Alice II',
      email: alice.email,
    });

    expect(EmailTaken.is(result)).toBe(true);
    expect(result).toMatchObject({
      code: 'conflict:email_taken',
      details: { email: alice.email },
    });
  });

  it('с dryRun проверяет данные, не создавая запись', async () => {
    const repo = inMemoryUsersRepo([alice]);
    const handler = new CreateUserHandler(repo);

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
      dryRun: true,
    });

    expect(result).toMatchObject({ id: 'dry-run', name: 'Carol' });
    expect(await repo.all()).toHaveLength(1);
  });
});
