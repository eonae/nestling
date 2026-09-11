/**
 * Адаптер хранилища на работающем PostgreSQL.
 *
 * Здесь гоняется общий набор проверок — тот же, что на реализации в
 * памяти, — и то, чего в памяти проверить нечем: две реплики relay,
 * разбирающие одну таблицу. Без адреса базы в окружении прогон
 * пропускается.
 */

import type { PgConnection } from '../src/index.js';
import type { StoreHarness } from '../src/outbox/__fixtures__/store-suite.js';
import {
  describeOutboxStore,
  makeOutboxRecord,
  NOW,
} from '../src/outbox/__fixtures__/store-suite.js';
import { outboxDdl, outboxTable, PgOutboxStore } from '../src/outbox/index.js';

import { describeWithDatabase, openTestConnection } from './support.js';

import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

/** Имя таблицы теста: своё, чтобы не спорить с примером */
const TABLE = 'e2e_outbox';

const schema = { outbox: outboxTable(TABLE) };

describeWithDatabase('адаптер хранилища на настоящей базе', () => {
  let connection: PgConnection<typeof schema>;
  let store: PgOutboxStore;

  beforeAll(async () => {
    connection = openTestConnection(schema);
    store = new PgOutboxStore(connection, TABLE);

    await connection.db.execute(sql.raw(outboxDdl(TABLE)));
  });

  afterAll(async () => {
    await connection.db.execute(
      sql`DROP TABLE IF EXISTS ${sql.identifier(TABLE)}`,
    );
    await connection.end();
  });

  /** Убирает записи прошлой проверки */
  const clear = async (): Promise<void> => {
    await connection.db.execute(
      sql`TRUNCATE ${sql.identifier(TABLE)} RESTART IDENTITY`,
    );
  };

  /** Кладёт записи транзакцией, как их положил бы запрос */
  const append = async (
    records: Parameters<StoreHarness['append']>[0],
  ): Promise<void> => {
    const session = await connection.begin();

    try {
      await store.append(session.db, records);
      await session.commit();
    } finally {
      await session.release();
    }
  };

  /** Реализация под проверкой */
  const harness = (): StoreHarness => ({ store, append, clear });

  describeOutboxStore('адаптер на drizzle', harness);

  it('две реплики не получают одну запись', async () => {
    await clear();

    const records = Array.from({ length: 100 }, () => makeOutboxRecord());
    await append(records);

    const second = new PgOutboxStore(connection, TABLE);

    const [left, right] = await Promise.all([
      store.claim({ limit: 100, now: NOW }),
      second.claim({ limit: 100, now: NOW }),
    ]);

    const ids = [...left, ...right].map((record) => record.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(records.length);
  });

  it('запись коммитится вместе с бизнес-изменением', async () => {
    await clear();

    const session = await connection.begin();

    try {
      await store.append(session.db, [makeOutboxRecord()]);
      await session.rollback();
    } finally {
      await session.release();
    }

    expect(await store.claim({ limit: 10, now: NOW })).toHaveLength(0);
  });

  it('чужое значение транзакции названо ошибкой с обеими починками', async () => {
    await expect(store.append({}, [makeOutboxRecord()])).rejects.toThrow(
      /db\.transaction\(\).*outbox\({/s,
    );
  });
});
