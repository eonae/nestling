/**
 * Таблица записей outbox'а: объявление drizzle и её DDL.
 *
 * Форму таблицы задаёт тот, кто её читает, поэтому объявление приходит из
 * пакета, а не пишется приложением. Объявление включают в схему
 * drizzle-kit — и миграция генерируется вместе с остальными; готовая
 * строка DDL нужна тем, кто ведёт миграции своими средствами.
 */

import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** Имя таблицы по умолчанию */
export const DEFAULT_OUTBOX_TABLE = 'outbox';

/**
 * Объявление таблицы записей.
 *
 * Порядок создания задаёт отдельная возрастающая колонка `seq`, а не
 * идентификатор и не момент создания: идентификатор служит ключом
 * идемпотентности и порядка не несёт, а два момента создания в пределах
 * миллисекунды неразличимы.
 *
 * @param name - Имя таблицы; умолчание — `outbox`
 *
 * @example
 * ```typescript
 * export const schema = { users, outbox: outboxTable() };
 * ```
 */
export const outboxTable = (name: string = DEFAULT_OUTBOX_TABLE) =>
  pgTable(
    name,
    {
      /** Идентификатор записи; он же ключ идемпотентности публикации */
      id: text('id').primaryKey(),

      /** Порядок создания: единица сравнения внутри раздела */
      seq: bigserial('seq', { mode: 'number' }).notNull(),

      /** Subject операции — её имя */
      subject: text('subject').notNull(),

      /** Проверенный схемой payload */
      payload: jsonb('payload'),

      /** Долговечность доставки; берётся из операции */
      durable: boolean('durable').notNull(),

      /** Раздел, внутри которого порядок сохраняется */
      partitionKey: text('partition_key'),

      /** Переданный контекст вызова */
      context: jsonb('context'),

      /** Состояние выдачи: `pending`, `claimed`, `published`, `stuck` */
      state: text('state').notNull(),

      /** Сколько попыток публикации уже провалилось */
      attempts: integer('attempts').notNull().default(0),

      /** Момент, раньше которого запись не выдаётся */
      availableAt: timestamp('available_at', { withTimezone: true }).notNull(),

      /** Момент создания записи */
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),

      /** Момент выдачи relay */
      claimedAt: timestamp('claimed_at', { withTimezone: true }),

      /** Момент публикации */
      publishedAt: timestamp('published_at', { withTimezone: true }),
    },
    (table) => [
      // Выдача: записи, ожидающие публикации и уже готовые
      index(`${name}_ready_idx`).on(table.state, table.availableAt),
      // Порядок раздела: предыдущая запись того же раздела
      index(`${name}_partition_idx`).on(table.partitionKey, table.seq),
    ],
  );

/** Тип объявления таблицы */
export type OutboxTable = ReturnType<typeof outboxTable>;

/**
 * DDL таблицы записей — для тех, кто ведёт миграции сам.
 *
 * @param name - Имя таблицы; умолчание — `outbox`
 */
export const outboxDdl = (name: string = DEFAULT_OUTBOX_TABLE): string =>
  [
    `CREATE TABLE IF NOT EXISTS "${name}" (`,
    `  "id" text PRIMARY KEY NOT NULL,`,
    `  "seq" bigserial NOT NULL,`,
    `  "subject" text NOT NULL,`,
    `  "payload" jsonb,`,
    `  "durable" boolean NOT NULL,`,
    `  "partition_key" text,`,
    `  "context" jsonb,`,
    `  "state" text NOT NULL,`,
    `  "attempts" integer DEFAULT 0 NOT NULL,`,
    `  "available_at" timestamp with time zone NOT NULL,`,
    `  "created_at" timestamp with time zone NOT NULL,`,
    `  "claimed_at" timestamp with time zone,`,
    `  "published_at" timestamp with time zone`,
    `);`,
    `CREATE INDEX IF NOT EXISTS "${name}_ready_idx" ON "${name}" ("state", "available_at");`,
    `CREATE INDEX IF NOT EXISTS "${name}_partition_idx" ON "${name}" ("partition_key", "seq");`,
  ].join('\n');
