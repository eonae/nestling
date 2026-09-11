/**
 * Соединение и сессия на подстановке пула.
 *
 * Проверяется то, за что отвечает пакет: порядок команд, идемпотентность
 * завершения и возврат клиента в пул на каждом пути. Текст SQL проверяют
 * тесты на работающем PostgreSQL.
 */

import { FakePool } from './__fixtures__/pool.js';
import { schema } from './__fixtures__/schema.js';
import type { DatabaseConfigValues } from './config.js';
import { openConnection, PgConnection } from './connection.js';
import { PgConnectionFailedError } from './errors.js';

import { describe, expect, it } from '@jest/globals';
import { spyLogger } from '@nestlingjs/testing';

/** Соединение поверх подстановки */
const connectionOf = (pool: FakePool, statementTimeoutMs = 0) =>
  new PgConnection(pool.asPool(), schema, statementTimeoutMs);

/** Значения секции, которых хватает для открытия пула */
const config: DatabaseConfigValues = {
  url: 'postgresql://spec:secret@db.example:5432/spec',
  poolMax: 5,
  connectTimeoutMs: 1000,
  idleTimeoutMs: 1000,
  statementTimeoutMs: 0,
  ssl: false,
  host: 'db.example:5432',
};

describe('PgConnection.begin', () => {
  it('открывает транзакцию командой на клиенте пула', async () => {
    const pool = new FakePool();

    await connectionOf(pool).begin();

    expect(pool.commands).toEqual(['BEGIN']);
    expect(pool.leased).toBe(1);
  });

  it('вставляет уровень изоляции в команду открытия', async () => {
    const pool = new FakePool();

    await connectionOf(pool).begin({ isolation: 'serializable' });

    expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE']);
  });

  it('ставит потолок времени запроса на время транзакции', async () => {
    const pool = new FakePool();

    await connectionOf(pool, 2500).begin();

    expect(pool.commands).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout = 2500',
    ]);
  });

  it('возвращает клиента в пул, если открыть транзакцию не удалось', async () => {
    const pool = new FakePool();
    pool.failing.add('BEGIN');

    await expect(connectionOf(pool).begin()).rejects.toThrow(/BEGIN/);
    expect(pool.leased).toBe(0);
  });
});

describe('PgSession: завершение идемпотентно', () => {
  it('коммитит один раз', async () => {
    const pool = new FakePool();
    const session = await connectionOf(pool).begin();

    await session.commit();
    await session.commit();

    expect(pool.commands).toEqual(['BEGIN', 'COMMIT']);
  });

  it('после коммита откат и возврат новых команд не шлют', async () => {
    const pool = new FakePool();
    const session = await connectionOf(pool).begin();

    await session.commit();
    await session.rollback();
    await session.release();
    await session.release();

    expect(pool.commands).toEqual(['BEGIN', 'COMMIT']);
    expect(pool.leased).toBe(0);
  });

  it('возврат откатывает незавершённую транзакцию', async () => {
    const pool = new FakePool();
    const session = await connectionOf(pool).begin();

    await session.release();

    expect(pool.commands).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.leased).toBe(0);
  });

  it('провалившийся коммит завершает сессию: отката следом нет', async () => {
    const pool = new FakePool();
    pool.failing.add('COMMIT');
    const session = await connectionOf(pool).begin();

    await expect(session.commit()).rejects.toThrow(/COMMIT/);
    await session.release();

    expect(pool.commands).toEqual(['BEGIN', 'COMMIT']);
    expect(pool.leased).toBe(0);
  });
});

describe('PgConnection.health', () => {
  it('живое соединение отвечает `ok`', async () => {
    const pool = new FakePool();

    await expect(
      connectionOf(pool).health(AbortSignal.timeout(1000)),
    ).resolves.toBe('ok');
    expect(pool.commands).toEqual(['SELECT 1']);
  });

  it('провалившийся запрос отвечает `down`', async () => {
    const pool = new FakePool();
    pool.failing.add('SELECT 1');

    await expect(
      connectionOf(pool).health(AbortSignal.timeout(1000)),
    ).resolves.toBe('down');
  });
});

describe('openConnection', () => {
  it('недоступная база останавливает старт, называя имя и ключ', async () => {
    const spy = spyLogger();

    const failed = await openConnection(
      'analytics',
      'DATABASE_ANALYTICS_URL',
      schema,
      { ...config, url: 'postgresql://spec@127.0.0.1:1/none' },
      spy.logger,
      AbortSignal.timeout(5000),
    ).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(PgConnectionFailedError);
    expect((failed as Error).message).toContain('analytics');
    expect((failed as Error).message).toContain('DATABASE_ANALYTICS_URL');
  });

  it('текст ошибки не несёт адреса с паролем', async () => {
    const spy = spyLogger();

    const failed = await openConnection(
      'default',
      'DATABASE_URL',
      schema,
      { ...config, url: 'postgresql://spec:secret@127.0.0.1:1/none' },
      spy.logger,
      AbortSignal.timeout(5000),
    ).catch((error: unknown) => error);

    expect((failed as Error).message).not.toContain('secret');
  });
});
