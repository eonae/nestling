/**
 * Юнит-тест хендлера: класс создаётся через `new` с фейком, без
 * контейнера и транспорта.
 */

import { inMemoryUsersRepo } from '../../testing.js';
import { ActivityHub } from '../activity.hub.js';
import { EmailTaken } from '../users.errors.js';
import { UsersMetrics } from '../users.metrics.js';

import { CreateUserHandler } from './create-user.endpoint.js';

import { describe, expect, it } from '@jest/globals';
import { metricsFor } from '@nestlingjs/testing';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

/**
 * Лента активности: обычный объект, поэтому в тесте создаётся через
 * `new`. Ресурсом она становится только в контейнере
 */
const hub = (): ActivityHub => new ActivityHub();

/**
 * Писатель метрик для теста без контейнера: в приложении его раздаёт граф,
 * здесь — тестовый пакет. Записи читаются тем же способом, что у
 * тестового приложения.
 */
const metrics = () => metricsFor(UsersMetrics);

describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает статусом created', async () => {
    const activity = hub();
    const users = metrics();
    const handler = new CreateUserHandler(
      inMemoryUsersRepo([alice]),
      activity,
      users.metrics,
    );

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

    // Метрика исхода: ряд адресуется членом группы, а не строкой
    expect(
      users.read.counter(UsersMetrics.members.created, { outcome: 'stored' }),
    ).toBe(1);
  });

  it('возвращает отказ EmailTaken для занятого email', async () => {
    const users = metrics();
    const handler = new CreateUserHandler(
      inMemoryUsersRepo([alice]),
      hub(),
      users.metrics,
    );

    const result = await handler.handle({
      name: 'Alice II',
      email: alice.email,
    });

    expect(EmailTaken.is(result)).toBe(true);
    expect(result).toMatchObject({
      code: 'conflict:email_taken',
      details: { email: alice.email },
    });
    expect(
      users.read.counter(UsersMetrics.members.created, {
        outcome: 'email_taken',
      }),
    ).toBe(1);
  });

  it('с dryRun проверяет данные, не создавая запись', async () => {
    const repo = inMemoryUsersRepo([alice]);
    const handler = new CreateUserHandler(repo, hub(), metrics().metrics);

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
      dryRun: true,
    });

    // Исход `ok`: записи не было, и код ответа — 200, а не 201
    expect(result).toMatchObject({
      status: 'ok',
      value: { id: 'dry-run', name: 'Carol' },
    });
    expect(await repo.all()).toHaveLength(1);
  });
});
