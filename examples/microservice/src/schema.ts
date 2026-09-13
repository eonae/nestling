/**
 * Схема drizzle: таблица пользователей.
 *
 * Она едет одним значением в соединение и в drizzle-kit, поэтому
 * миграции генерируются из того же объявления, которым работает
 * хранилище.
 */

import { pgTable, text } from 'drizzle-orm/pg-core';

/** Таблица пользователей */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
});

/** Схема соединения: её тип доходит до репозитория */
export const schema = { users };
