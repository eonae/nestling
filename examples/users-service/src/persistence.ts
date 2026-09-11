/**
 * Инфраструктура хранения: соединение, хранилище outbox'а и слой
 * транзакции.
 *
 * Все три — значения пакета `@nestlingjs/drizzle.pg`. Приложение не пишет
 * ни ресурса пула, ни юнита-моста, ни адаптера `OutboxStore`: хранилище и
 * транзакция обязаны быть на одном соединении, поэтому их везёт один
 * пакет.
 */

import { authed } from './auth.js';
import { schema } from './schema.js';

import { compose } from '@nestlingjs/app';
import { drizzlePg } from '@nestlingjs/drizzle.pg';
import { pgOutboxStore } from '@nestlingjs/drizzle.pg/outbox';

/**
 * Соединение с базой.
 *
 * Экземпляр один, поэтому имени у него нет: ключи читаются как
 * `DATABASE_URL` и `DATABASE_POOL_MAX`, а переменная транзакции
 * называется `tx`. Второе соединение объявлялось бы вторым вызовом с
 * полем `name`.
 */
export const db = drizzlePg({ schema });

/** Хранилище outbox'а на том же соединении, что и таблица пользователей */
export const outboxStore = pgOutboxStore(db);

/**
 * Слой транзакции поверх `authed`.
 *
 * Транзакция открывается пайплайном, а не колбэком `db.transaction(cb)`:
 * снаружи колбэка транзакции нет, и репозиторий с эмиттером не смогли бы
 * её прочитать. Слой коммитит на успехе, откатывает на отказе и
 * возвращает соединение в пул на любом исходе.
 */
export const transactional = compose(authed, db.transaction());
