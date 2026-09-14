/**
 * Инфраструктура хранения: соединение, хранилища outbox'а и приёма, слои
 * транзакции.
 *
 * Все они — значения пакета `@nestlingjs/drizzle.pg`. Приложение не пишет
 * ни ресурса пула, ни шага-моста, ни адаптеров: хранилище и транзакция
 * обязаны быть на одном соединении, поэтому их везёт один пакет.
 *
 * Файл лежит вне фич: соединение делят обе. В профиле `split` каждый
 * процесс открывает свой пул к той же базе.
 */

import { traced } from './base.js';
import { schema } from './schema.js';

import { compose } from '@nestlingjs/app';
import { makeDrizzlePg } from '@nestlingjs/drizzle.pg';
import { makePgInboxStore } from '@nestlingjs/drizzle.pg/inbox';
import { makePgOutboxStore } from '@nestlingjs/drizzle.pg/outbox';
import { makeInbox } from '@nestlingjs/inbox';

/**
 * Соединение с базой.
 *
 * Экземпляр один, поэтому имени у него нет: ключи читаются как
 * `DATABASE_URL` и `DATABASE_POOL_MAX`, а переменная транзакции
 * называется `tx`. Второе соединение объявлялось бы вторым вызовом с
 * полем `name`.
 */
export const db = makeDrizzlePg({ schema });

/** Хранилище outbox'а на том же соединении, что и таблица пользователей */
export const outboxStore = makePgOutboxStore(db);

/** Хранилище отметок приёма — там же: отметка коммитится с изменением */
export const inboxStore = makePgInboxStore(db);

/**
 * Транзакционный приём: повтор доставки не доходит до хендлера.
 *
 * Плагин объявлен здесь, а не в корне: его поле `layer` нужно декларации
 * подписчика, а корень импортирует фичу, в которой эта декларация лежит.
 */
export const inbox = makeInbox({ transaction: db.tx, store: inboxStore.token });

/**
 * Слой транзакции поверх базового.
 *
 * Транзакция открывается пайплайном, а не колбэком `db.transaction(cb)`:
 * снаружи колбэка транзакции нет, и репозиторий с эмиттером не смогли бы
 * её прочитать. Слой коммитит на успехе, откатывает на отказе и
 * возвращает соединение в пул на любом исходе.
 */
export const transactional = compose(traced, db.transaction());
