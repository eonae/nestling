/**
 * Транзакция запроса на работающем PostgreSQL.
 *
 * Здесь проверяется то, чего подстановка пула не проверяет: видимость
 * записи внутри транзакции, откат и уровень изоляции. Без адреса базы в
 * окружении прогон пропускается.
 */

import type { PgConnection } from '../src/index.js';

import { describeWithDatabase, openTestConnection } from './support.js';

import { afterAll, beforeAll, beforeEach, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';

const people = pgTable('e2e_people', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
});

const schema = { people };

describeWithDatabase('транзакция запроса на настоящей базе', () => {
  let connection: PgConnection<typeof schema>;

  beforeAll(async () => {
    connection = openTestConnection(schema);

    await connection.db.execute(sql`
      CREATE TABLE IF NOT EXISTS "e2e_people" (
        "id" text PRIMARY KEY NOT NULL,
        "email" text NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    await connection.db.execute(sql`TRUNCATE "e2e_people"`);
  });

  afterAll(async () => {
    await connection.db.execute(sql`DROP TABLE IF EXISTS "e2e_people"`);
    await connection.end();
  });

  it('запись видна внутри транзакции и невидима снаружи', async () => {
    const session = await connection.begin();

    await session.db
      .insert(people)
      .values({ id: 'p-1', email: 'alice@example.com' });

    const inside = await session.db.select().from(people);
    const outside = await connection.db.select().from(people);

    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);

    await session.release();
  });

  it('коммит делает запись видимой', async () => {
    const session = await connection.begin();

    await session.db
      .insert(people)
      .values({ id: 'p-2', email: 'bob@example.com' });
    await session.commit();
    await session.release();

    expect(await connection.db.select().from(people)).toHaveLength(1);
  });

  it('откат не оставляет записи', async () => {
    const session = await connection.begin();

    await session.db
      .insert(people)
      .values({ id: 'p-3', email: 'carol@example.com' });
    await session.rollback();
    await session.release();

    expect(await connection.db.select().from(people)).toHaveLength(0);
  });

  it('уровень изоляции доходит до сессии', async () => {
    const session = await connection.begin({ isolation: 'serializable' });

    const result = await session.db.execute<{ transaction_isolation: string }>(
      sql`SHOW transaction_isolation`,
    );

    expect(result.rows[0].transaction_isolation).toBe('serializable');

    await session.release();
  });

  it('SQL пакета исполняется базой: `SET LOCAL` не ломает транзакцию', async () => {
    const session = await connection.begin();

    const result = await session.db.execute<{ statement_timeout: string }>(
      sql`SHOW statement_timeout`,
    );

    expect(typeof result.rows[0].statement_timeout).toBe('string');

    await session.release();
  });
});
