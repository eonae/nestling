/**
 * Пакет в собранном приложении: два соединения, слой в пайплайне,
 * политика предпосылки.
 *
 * Соединение подменяется на подстановку пула: настоящая база здесь не
 * нужна, а тесты, которым она нужна, живут в `e2e/`.
 */

import { analytics, CreateUser, db, Ping } from './__fixtures__/app.js';
import { FakePool } from './__fixtures__/pool.js';
import { analyticsSchema, schema } from './__fixtures__/schema.js';
import { testTransport } from './__fixtures__/transport.js';
import { PgConnection } from './connection.js';
import { PgDuplicateConnectionError } from './errors.js';
import { drizzlePg } from './plugin.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition, App } from '@nestlingjs/app';
import { makeApp, makeFeature } from '@nestlingjs/app';
import { assembleTest, vars } from '@nestlingjs/testing';

/** Пул соединения по умолчанию: журнал команд читают тесты */
const pool = new FakePool();

/** Соединение по умолчанию поверх подстановки */
const connection = new PgConnection(pool.asPool(), schema, 0);

/** Второе соединение: своя подстановка, своя схема */
const analyticsConnection = new PgConnection(
  new FakePool().asPool(),
  analyticsSchema,
  0,
);

/** Значения, которых хватает обеим секциям */
const config = vars({
  DATABASE_URL: 'postgresql://spec@localhost:5432/spec',
  DATABASE_ANALYTICS_URL: 'postgresql://spec@localhost:5432/reports',
});

/** Приложение с обоими соединениями и политикой предпосылки */
const application = (endpoints: readonly AnyEndpointDefinition[]): App =>
  makeApp({
    features: [makeFeature({ name: 'users', endpoints })],
    plugins: [db, analytics],
    transports: [testTransport()],
    policies: [db.requiresTransaction({ pattern: /^POST / })],
  });

describe('drizzlePg(): соединение в собранном приложении', () => {
  it('запрос идёт в транзакции: `BEGIN`, запись, `COMMIT`', async () => {
    pool.commands.length = 0;
    await using app = await assembleTest(application([CreateUser]), {
      overrides: [
        [db.connection, connection],
        [analytics.connection, analyticsConnection],
      ],
      config,
    });

    const response = await app.call(CreateUser, {
      id: 'u-1',
      email: 'alice@example.com',
    });

    expect(response.isSuccess).toBe(true);
    expect(pool.commands[0]).toBe('BEGIN');
    expect(pool.commands.at(-1)).toBe('COMMIT');
    expect(pool.leased).toBe(0);
  });

  it('ключи второго соединения несут имя экземпляра', () => {
    expect(db.keys.names).toContain('DATABASE_URL');
    expect(analytics.keys.names).toContain('DATABASE_ANALYTICS_URL');
  });

  it('переменные соединений не спорят за поле контекста', () => {
    expect(db.tx.key).toBe('tx');
    expect(analytics.tx.key).toBe('analyticsTx');
  });

  it('идентификатор DI-токена — имя проверки в пробах', () => {
    expect(db.connection.id).toBe('database');
    expect(analytics.connection.id).toBe('database:analytics');
  });
});

describe('drizzlePg(): политика предпосылки', () => {
  it('endpoint под фильтром без слоя роняет сборку', async () => {
    await expect(
      assembleTest(application([Ping]), {
        overrides: [
          [db.connection, connection],
          [analytics.connection, analyticsConnection],
        ],
        config,
      }),
    ).rejects.toThrow(/POST ping/);
  });

  it('endpoint со слоем политику удовлетворяет', async () => {
    await using app = await assembleTest(application([CreateUser]), {
      overrides: [
        [db.connection, connection],
        [analytics.connection, analyticsConnection],
      ],
      config,
    });

    expect(app.get(db.connection)).toBe(connection);
  });
});

describe('drizzlePg(): повторное имя', () => {
  it('второе соединение с тем же именем не объявляется', () => {
    expect(() =>
      drizzlePg({ name: 'analytics', schema: analyticsSchema }),
    ).toThrow(PgDuplicateConnectionError);
  });

  it('текст ошибки называет имя экземпляра', () => {
    expect(() => drizzlePg({ schema })).toThrow(/'default'/);
  });
});
