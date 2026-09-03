/**
 * Юнит-тест хендлера: фабрика вызывается с фейком, без контейнера и
 * транспорта.
 */

import { inMemoryUsersRepo } from '../../testing';
import { EmailTaken } from '../users.errors';

import { createUserHandler } from './create-user.endpoint';

import { describe, expect, it } from '@jest/globals';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

describe('createUserHandler', () => {
  it('создаёт пользователя и отвечает 201 с заголовком Location', async () => {
    const handle = createUserHandler(inMemoryUsersRepo([alice]));

    const result = await handle({ name: 'Carol', email: 'carol@example.com' });

    expect(result).toMatchObject({
      value: { id: '2', name: 'Carol' },
      headers: { Location: '/users/2' },
    });
  });

  it('возвращает отказ EmailTaken для занятого email', async () => {
    const handle = createUserHandler(inMemoryUsersRepo([alice]));

    const result = await handle({ name: 'Alice II', email: alice.email });

    expect(EmailTaken.is(result)).toBe(true);
    expect(result).toMatchObject({
      status: 'conflict',
      details: { email: alice.email },
    });
  });
});
