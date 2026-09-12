/**
 * Инфраструктура хранения: соединение, хранилища outbox'а и приёма, слои
 * транзакции.
 *
 * Все они — значения пакета `@nestlingjs/drizzle.pg`. Приложение не пишет
 * ни ресурса пула, ни юнита-моста, ни адаптеров: хранилище и транзакция
 * обязаны быть на одном соединении, поэтому их везёт один пакет.
 */

import { authed } from './auth.js';
import { observability } from './observability.js';
import { schema } from './schema.js';

import { compose } from '@nestlingjs/app';
import { drizzlePg } from '@nestlingjs/drizzle.pg';
import { pgInboxStore } from '@nestlingjs/drizzle.pg/inbox';
import { pgOutboxStore } from '@nestlingjs/drizzle.pg/outbox';
import { inbox } from '@nestlingjs/inbox';

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

/** Хранилище отметок приёма — там же: отметка коммитится с изменением */
export const inboxStore = pgInboxStore(db);

/**
 * Транзакционный приём: повтор доставки не доходит до хендлера.
 *
 * Плагин объявлен здесь, а не в корне: его поле `layer` нужно декларации
 * подписчика, а корень импортирует фичу, в которой эта декларация лежит.
 */
export const appInbox = inbox({ transaction: db.tx, store: inboxStore.token });

/**
 * Слой транзакции поверх `authed`.
 *
 * Транзакция открывается пайплайном, а не колбэком `db.transaction(cb)`:
 * снаружи колбэка транзакции нет, и репозиторий с эмиттером не смогли бы
 * её прочитать. Слой коммитит на успехе, откатывает на отказе и
 * возвращает соединение в пул на любом исходе.
 */
export const transactional = compose(authed, db.transaction());

/**
 * Слой транзакции для подписчика шины.
 *
 * Bearer-токена у сообщения нет: его отправил relay, а не клиент,
 * поэтому и проверки в этом слое нет. Наблюдаемость остаётся — подписчик
 * пишет ту же строку аудита, что и HTTP-endpoint.
 */
export const subscribed = compose(observability, db.transaction());
