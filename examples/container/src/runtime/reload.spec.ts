/**
 * Reloadable-секция на живом графе: источник меняет значение, потребитель
 * видит новое без пересборки, подписка получает уведомление.
 */

import { makeContainer } from '../container.js';

import { RateLimiter } from './rate-limiter.js';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ObjectSource } from '@nestlingjs/app';
import { objectSource } from '@nestlingjs/app';
import type { BuiltContainer } from '@nestlingjs/container';

/** Даёт уведомлениям подписки выполниться */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('reloadable-секция', () => {
  let container: BuiltContainer;
  let source: ObjectSource;
  let limiter: RateLimiter;
  // Канал остановки для `@OnStart`: `RateLimiter` снимает подписку `onChange`
  // по нему же, отдельного `AbortController` у него нет
  let shutdown: AbortController;

  beforeAll(async () => {
    // Секция `health` читает `DATABASE_URL` без значения по умолчанию
    process.env.DATABASE_URL = 'postgresql://db:5432/app';
    source = objectSource({ RUNTIME_RPS: '10' }, 'runtime');
    container = await makeContainer(source);
    await container.init();
    shutdown = new AbortController();
    // Подписка `onChange` открывается в `@OnStart`
    await container.start(shutdown.signal);
    limiter = container.getOrThrow(RateLimiter);
  });

  afterAll(async () => {
    shutdown.abort();
    await container.destroy();
    delete process.env.DATABASE_URL;
  });

  it('читает значение из привязанного источника', () => {
    expect(limiter.limit).toBe(10);
  });

  it('отдаёт новое значение после обновления источника', async () => {
    source.set('RUNTIME_RPS', '20');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });

  it('оставляет последнее валидное значение при невалидном обновлении', async () => {
    source.set('RUNTIME_RPS', 'many');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });
});
