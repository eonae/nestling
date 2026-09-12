/**
 * Схема drizzle: таблица пользователей, таблица записей outbox'а и
 * таблица отметок приёма.
 *
 * Все три едут одним значением в соединение и в drizzle-kit, поэтому
 * миграции таблиц пакета генерируются вместе с миграциями приложения.
 * Сами объявления приходят из пакета: форму задаёт тот, кто их читает.
 *
 * Объявления берутся листовыми подпутями `outbox/table` и `inbox/table`,
 * а не подпутями целиком: схему читает drizzle-kit, а он собирает её как
 * CJS, и из пакета ему годится только то, что не тянет за собой ядро.
 */

import { inboxTable } from '@nestlingjs/drizzle.pg/inbox/table';
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

/** Таблица отметок приёма */
export const inbox = inboxTable();

/** Схема соединения: её тип доходит до репозитория */
export const schema = { users, outbox, inbox };
