/**
 * Секреты и общий ключ на живом приложении: печать редактирована, чтение —
 * нет, а секретность `DATABASE_URL` действует и на секцию `health`, которая
 * ничего не помечала.
 */

import { inspect } from 'node:util';

import { HealthConfig } from '../health';

import { AppConfig } from './app.config';

import type { Config } from '@nestling/config';
import { describeConfig } from '@nestling/config';
import type { BuiltContainer } from '@nestling/container';

const PASSWORD = 'sup3r-s3cret';
const DB_URL = `postgresql://user:${PASSWORD}@db:5432/app`;

/**
 * Корень импортируется **после** установки переменной: читалка держит живую
 * ссылку на `process.env`, а не снимок, но модуль-корень тянет за собой
 * декларации, и порядок импорта в тесте должен быть честным.
 */
const boot = async (): Promise<BuiltContainer> => {
  process.env.DATABASE_URL = DB_URL;

  const { makeContainer } = await import('../container');

  return await makeContainer();
};

describe('секреты в примере', () => {
  let container: BuiltContainer;

  beforeAll(async () => {
    container = await boot();
  });

  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it('печать секции не содержит настоящего значения', () => {
    const config = container.getOrThrow(AppConfig) as Config<typeof AppConfig>;

    expect(JSON.stringify(config)).not.toContain(PASSWORD);
    expect(JSON.stringify(config)).toContain('***');
    expect(inspect(config)).not.toContain(PASSWORD);
  });

  it('потребитель, читающий поле, получает настоящее значение', () => {
    const config = container.getOrThrow(AppConfig) as Config<typeof AppConfig>;

    expect(config.databaseUrl).toBe(DB_URL);
  });

  it('секретность ключа распространяется на секцию `health`', () => {
    const health = container.getOrThrow(HealthConfig) as Config<
      typeof HealthConfig
    >;

    expect(health.databaseUrl).toBe(DB_URL);
    expect(JSON.stringify(health)).toBe(JSON.stringify({ databaseUrl: '***' }));
  });

  it('снимок реестра показывает обоих читателей общего ключа', () => {
    const entry = describeConfig().keys.find(
      (item) => item.key === 'DATABASE_URL',
    );

    expect(entry?.secret).toBe(true);
    expect(entry?.readers.map((reader) => reader.section).sort()).toEqual([
      'app',
      'health',
    ]);
  });
});
