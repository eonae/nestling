/**
 * Адаптер `OutboxStore` на drizzle.
 *
 * Запись идёт транзакцией вызывающего, поэтому строка события и строка
 * бизнес-изменения коммитятся вместе. Выдача и отметка идут на пуле:
 * relay живёт вне запроса и транзакции не имеет.
 */

import type { PgConnection, PgSchema, PgTx } from '../connection.js';

import { PgOutboxTransactionError } from './errors.js';
import type { OutboxTable } from './table.js';
import { DEFAULT_OUTBOX_TABLE, outboxTable } from './table.js';

import type {
  ClaimedRecord,
  OutboxClaimOptions,
  OutboxRecord,
  OutboxSettlement,
  OutboxStore,
} from '@nestlingjs/outbox';
import { sql } from 'drizzle-orm';

/**
 * Строка выдачи в том виде, в каком её отдаёт драйвер.
 *
 * Момент создания приходит отдельной колонкой в epoch-миллисекундах:
 * drizzle ставит драйверу свои разборщики типов, и метка времени в сыром
 * запросе приходит строкой своего формата, а не значением `Date`.
 */
interface OutboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly subject: string;
  readonly payload: unknown;
  readonly durable: boolean;
  readonly partition_key: string | null;
  readonly context: unknown;
  readonly attempts: string | number;
  readonly created_ms: string | number;
  readonly seq: string | number;
}

/** Значение json-колонки: драйвер отдаёт либо объект, либо его текст */
const fromJson = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value;

/** Значение транзакции: экземпляр drizzle этого соединения */
function assertTx(value: unknown): asserts value is PgTx<PgSchema> {
  const candidate = value as { insert?: unknown; execute?: unknown } | null;

  if (
    typeof candidate?.insert !== 'function' ||
    typeof candidate.execute !== 'function'
  ) {
    throw new PgOutboxTransactionError(
      value === null || value === undefined ? String(value) : typeof value,
    );
  }
}

/** Строка таблицы из значения записи */
const toRow = (record: OutboxRecord): OutboxTable['$inferInsert'] => ({
  id: record.id,
  subject: record.subject,
  payload: record.payload ?? null,
  durable: record.durable,
  partitionKey: record.partitionKey ?? null,
  context: record.context ?? null,
  state: 'pending',
  attempts: 0,
  availableAt: new Date(record.createdAt),
  createdAt: new Date(record.createdAt),
});

/** Запись, взятая в работу, из строки выдачи */
const toClaimed = (row: OutboxRow): ClaimedRecord => ({
  id: row.id,
  subject: row.subject,
  payload: fromJson(row.payload),
  durable: row.durable,
  ...(row.partition_key === null ? {} : { partitionKey: row.partition_key }),
  ...(row.context === null || row.context === undefined
    ? {}
    : { context: fromJson(row.context) as Record<string, unknown> }),
  createdAt: Number(row.created_ms),
  attempts: Number(row.attempts),
});

/**
 * Хранилище записей в PostgreSQL.
 *
 * Семантика повторяет `InMemoryOutboxStore`: партия не выдаётся дважды,
 * порядок раздела держится выдачей, отметка исходов идемпотентна.
 * Расхождение между реализациями — дефект, и его ловит общий набор
 * проверок.
 */
export class PgOutboxStore implements OutboxStore {
  /** Объявление таблицы: им идёт вставка транзакцией вызывающего */
  private readonly declaration: OutboxTable;

  constructor(
    private readonly connection: PgConnection<PgSchema>,
    /** Имя таблицы записей */
    private readonly table: string = DEFAULT_OUTBOX_TABLE,
  ) {
    this.declaration = outboxTable(table);
  }

  async append(
    transaction: unknown,
    records: readonly OutboxRecord[],
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }

    assertTx(transaction);

    // Вставка идёт транзакцией вызывающего: строка события и строка
    // бизнес-изменения коммитятся вместе или не коммитятся вовсе
    await transaction.insert(this.declaration).values(records.map(toRow));
  }

  async claim(options: OutboxClaimOptions): Promise<readonly ClaimedRecord[]> {
    const now = sql`to_timestamp(${options.now}::double precision / 1000)`;

    const result = await this.connection.db.execute<OutboxRow>(sql`
      UPDATE ${this.name} AS o
      SET "state" = 'claimed', "claimed_at" = now()
      FROM (
        SELECT c."id"
        FROM ${this.name} c
        WHERE c."state" = 'pending'
          AND c."available_at" <= ${now}
          AND (
            c."partition_key" IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM ${this.name} p
              WHERE p."partition_key" = c."partition_key"
                AND p."seq" < c."seq"
                AND (
                  p."state" = 'claimed'
                  OR (p."state" = 'pending' AND p."available_at" > ${now})
                )
            )
          )
        ORDER BY c."seq"
        LIMIT ${options.limit}
        FOR UPDATE SKIP LOCKED
      ) AS picked
      WHERE o."id" = picked."id"
      RETURNING o."id", o."seq", o."subject", o."payload", o."durable",
                o."partition_key", o."context", o."attempts",
                (extract(epoch from o."created_at") * 1000)::bigint
                  AS "created_ms"
    `);

    return [...result.rows]
      .sort((left, right) => Number(left.seq) - Number(right.seq))
      .map((row) => toClaimed(row));
  }

  async settle(outcomes: readonly OutboxSettlement[]): Promise<void> {
    const published = outcomes.filter(
      (outcome) => outcome.status === 'published',
    );
    const stuck = outcomes.filter((outcome) => outcome.status === 'stuck');
    const retried = outcomes.filter((outcome) => outcome.status === 'retry');

    if (published.length > 0) {
      await this.connection.db.execute(sql`
        UPDATE ${this.name}
        SET "state" = 'published', "published_at" = now()
        WHERE "id" IN ${idList(published.map((outcome) => outcome.id))}
          AND "state" = 'claimed'
      `);
    }

    if (stuck.length > 0) {
      await this.connection.db.execute(sql`
        UPDATE ${this.name}
        SET "state" = 'stuck'
        WHERE "id" IN ${idList(stuck.map((outcome) => outcome.id))}
          AND "state" = 'claimed'
      `);
    }

    if (retried.length > 0) {
      const rows = retried.map(
        (outcome) => sql`(
          ${outcome.id},
          ${outcome.attempts}::integer,
          to_timestamp(${outcome.availableAt}::double precision / 1000)
        )`,
      );

      await this.connection.db.execute(sql`
        UPDATE ${this.name} AS o
        SET "state" = 'pending',
            "attempts" = v."attempts",
            "available_at" = v."available_at"
        FROM (VALUES ${sql.join(rows, sql`, `)})
          AS v("id", "attempts", "available_at")
        WHERE o."id" = v."id" AND o."state" = 'claimed'
      `);
    }
  }

  /** Имя таблицы идентификатором: в текст запроса оно едет так */
  private get name() {
    return sql.identifier(this.table);
  }
}

/** Список идентификаторов для `IN` */
const idList = (ids: readonly string[]) =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
