/**
 * Схема drizzle: таблица пользователей и таблица записей outbox'а.
 *
 * Обе едут одним значением в соединение и в drizzle-kit, поэтому миграция
 * таблицы записей генерируется вместе с миграциями приложения. Само
 * объявление таблицы записей приходит из пакета: форму задаёт тот, кто
 * её читает.
 *
 * Объявление берётся листовым подпутём `outbox/table`, а не подпутём
 * `outbox` целиком: схему читает drizzle-kit, а он собирает её как CJS, и
 * из пакета ему годится только то, что не тянет за собой ядро.
 */

import { outboxTable } from '@nestlingjs/drizzle.pg/outbox/table';
import { pgTable, text } from 'drizzle-orm/pg-core';

/** Таблица пользователей */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
});

/** Таблица записей outbox'а */
export const outbox = outboxTable();

/** Схема соединения: её тип доходит до репозитория */
export const schema = { users, outbox };
