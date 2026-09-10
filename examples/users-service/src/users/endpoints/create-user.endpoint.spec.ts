/**
 * Юнит-тест хендлера: класс создаётся через `new` с фейком, без
 * контейнера и транспорта.
 */

import { inMemoryUsersRepo } from '../../testing.js';
import { EmailTaken } from '../users.errors.js';
import type { UserCreated } from '../users.events.js';

import { CreateUserHandler } from './create-user.endpoint.js';

import { describe, expect, it } from '@jest/globals';
import type { Emitter } from '@nestlingjs/operations';

const alice = { id: '1', name: 'Alice', email: 'alice@example.com' };

/**
 * Фейк транзакционного эмиттера: юнит-тест собирает хендлер через `new`,
 * поэтому вместо DI-токена в конструктор идёт обычное значение.
 */
function fakeEmitter(): Emitter<typeof UserCreated> & {
  readonly emitted: unknown[];
} {
  const emitted: unknown[] = [];

  return {
    emitted,
    emit: async (payload?: unknown) => {
      emitted.push(payload);
    },
  } as Emitter<typeof UserCreated> & { readonly emitted: unknown[] };
}

describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает статусом created', async () => {
    const userCreated = fakeEmitter();
    const handler = new CreateUserHandler(
      inMemoryUsersRepo([alice]),
      userCreated,
    );

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
    });

    // Событие отправлено транзакционным эмиттером: в шину оно уйдёт
    // после коммита, а здесь важно, что хендлер его отправил
    expect(userCreated.emitted).toEqual([
      { id: '2', name: 'Carol', email: 'carol@example.com' },
    ]);
  });

  it('возвращает отказ EmailTaken для занятого email', async () => {
    const handler = new CreateUserHandler(
      inMemoryUsersRepo([alice]),
      fakeEmitter(),
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
  });

  it('с dryRun проверяет данные, не создавая запись', async () => {
    const repo = inMemoryUsersRepo([alice]);
    const userCreated = fakeEmitter();
    const handler = new CreateUserHandler(repo, userCreated);

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
      dryRun: true,
    });

    expect(result).toMatchObject({ id: 'dry-run', name: 'Carol' });
    expect(await repo.all()).toHaveLength(1);
    expect(userCreated.emitted).toEqual([]);
  });
});
