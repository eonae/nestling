/**
 * Юнит-тест хендлера: класс создаётся через `new` с фейком, без
 * контейнера и транспорта.
 */

import { inMemoryUsersRepo } from '../../testing.js';
import { ActivityHub } from '../activity.hub.js';
import { EmailTaken } from '../users.errors.js';

import { CreateUserHandler } from './create-user.endpoint.js';

import { describe, expect, it } from '@jest/globals';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

/**
 * Лента активности: обычный объект, поэтому в тесте создаётся через
 * `new`. Ресурсом она становится только в контейнере
 */
const hub = (): ActivityHub => new ActivityHub();

describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает статусом created', async () => {
    const activity = hub();
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]), activity);

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
    });

    // Событие ленты опубликовано: подписчиков у него может не быть, и
    // `publish` их не ждёт
    expect(activity.subscribers).toBe(0);
  });

  it('возвращает отказ EmailTaken для занятого email', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]), hub());

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
    const handler = new CreateUserHandler(repo, hub());

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
      dryRun: true,
    });

    expect(result).toMatchObject({ id: 'dry-run', name: 'Carol' });
    expect(await repo.all()).toHaveLength(1);
  });
});
