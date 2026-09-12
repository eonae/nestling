/**
 * Адаптер хранилища отметок на работающем PostgreSQL.
 *
 * Здесь гоняется общий набор проверок — тот же, что на реализации в
 * памяти, — и то, чего в памяти проверить нечем: две реплики,
 * получившие одно сообщение. Без адреса базы в окружении прогон
 * пропускается.
 *
 * Набор приходит из `@nestlingjs/inbox` относительным путём: он живёт
 * рядом с интерфейсом, который описывает, и копии здесь быть не должно.
 */

import type { InboxStoreHarness } from '../../nestling.inbox/src/__fixtures__/store-suite.js';
import {
  describeInboxStore,
  makeInboxMark,
} from '../../nestling.inbox/src/__fixtures__/store-suite.js';
import { inboxDdl, inboxTable, PgInboxStore } from '../src/inbox/index.js';
import type { PgConnection } from '../src/index.js';

import { describeWithDatabase, openTestConnection } from './support.js';

import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

/** Имя таблицы теста: своё, чтобы не спорить с примером */
const TABLE = 'e2e_inbox';

const schema = { inbox: inboxTable(TABLE) };

describeWithDatabase('адаптер отметок на настоящей базе', () => {
  let connection: PgConnection<typeof schema>;
  let store: PgInboxStore;

  beforeAll(async () => {
    connection = openTestConnection(schema);
    store = new PgInboxStore(connection, TABLE);

    await connection.db.execute(sql.raw(inboxDdl(TABLE)));
  });

  afterAll(async () => {
    await connection.db.execute(
      sql`DROP TABLE IF EXISTS ${sql.identifier(TABLE)}`,
    );
    await connection.end();
  });

  /** Убирает отметки прошлой проверки */
  const clear = async (): Promise<void> => {
    await connection.db.execute(sql`TRUNCATE ${sql.identifier(TABLE)}`);
  };

  /** Открывает транзакцию, отдаёт её телу и закрывает названным исходом */
  const run: InboxStoreHarness['run'] = async (outcome, body) => {
    const session = await connection.begin();

    try {
      const result = await body(session.db);

      await (outcome === 'commit' ? session.commit() : session.rollback());

      return result;
    } finally {
      await session.release();
    }
  };

  describeInboxStore(
    'InboxStore: адаптер PostgreSQL',
    (): InboxStoreHarness => ({ store, run, clear }),
  );

  it('две реплики с одной парой дают одну обработку', async () => {
    await clear();
    const mark = makeInboxMark();

    const first = await connection.begin();
    const second = await connection.begin();

    try {
      expect(await store.claim(first.db, mark)).toBe('claimed');

      // Вторая транзакция ждёт первую на замке строки, поэтому её отметка
      // запрашивается после коммита первой
      const pending = store.claim(second.db, mark);
      await first.commit();

      expect(await pending).toBe('duplicate');

      // Проигравшая транзакция остаётся пригодной для коммита: конфликт
      // уникальности её не рвал
      await second.db.execute(sql`SELECT 1`);
      await expect(second.commit()).resolves.toBeUndefined();
    } finally {
      await first.release();
      await second.release();
    }
  });
});
