/**
 * Схема drizzle для тестов пакета: одна таблица и одна чужая.
 *
 * Чужая нужна проверкам типов: обращение к таблице не своей схемы —
 * ошибка компиляции, и это проверяется именно на ней.
 */

import { integer, pgTable, text } from 'drizzle-orm/pg-core';

/** Таблица соединения под тестом */
export const users = pgTable('spec_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
});

/** Таблица другого соединения */
export const reports = pgTable('spec_reports', {
  id: text('id').primaryKey(),
  hits: integer('hits').notNull(),
});

/** Схема соединения под тестом */
export const schema = { users };

/** Схема второго соединения */
export const analyticsSchema = { reports };
