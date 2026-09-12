/**
 * Таблица отметок приёма: объявление drizzle и её DDL.
 *
 * Форму таблицы задаёт тот, кто её читает, поэтому объявление приходит из
 * пакета, а не пишется приложением. Объявление включают в схему
 * drizzle-kit — и миграция генерируется вместе с остальными; готовая
 * строка DDL нужна тем, кто ведёт миграции своими средствами.
 */

import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** Имя таблицы по умолчанию */
export const DEFAULT_INBOX_TABLE = 'inbox';

/**
 * Объявление таблицы отметок.
 *
 * Первичный ключ составной — потребитель и ключ идемпотентности. На нём
 * же держится разрешение гонки: вторая вставка той же пары конфликтует с
 * первой, и адаптер читает конфликт как повтор.
 *
 * @param name - Имя таблицы; умолчание — `inbox`
 *
 * @example
 * ```typescript
 * export const schema = { users, inbox: inboxTable() };
 * ```
 */
export const inboxTable = (name: string = DEFAULT_INBOX_TABLE) =>
  pgTable(
    name,
    {
      /** Потребитель: паттерн endpoint'а */
      consumer: text('consumer').notNull(),

      /** Ключ идемпотентности сообщения */
      key: text('key').notNull(),

      /** Момент постановки отметки */
      receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.consumer, table.key] }),
      // Проход уборщика: отметки старше срока хранения
      index(`${name}_received_idx`).on(table.receivedAt),
    ],
  );

/** Тип объявления таблицы */
export type InboxTable = ReturnType<typeof inboxTable>;

/**
 * DDL таблицы отметок — для тех, кто ведёт миграции сам.
 *
 * @param name - Имя таблицы; умолчание — `inbox`
 */
export const inboxDdl = (name: string = DEFAULT_INBOX_TABLE): string =>
  [
    `CREATE TABLE IF NOT EXISTS "${name}" (`,
    `  "consumer" text NOT NULL,`,
    `  "key" text NOT NULL,`,
    `  "received_at" timestamp with time zone NOT NULL,`,
    `  CONSTRAINT "${name}_consumer_key_pk" PRIMARY KEY("consumer","key")`,
    `);`,
    `CREATE INDEX IF NOT EXISTS "${name}_received_idx" ON "${name}" ("received_at");`,
  ].join('\n');
