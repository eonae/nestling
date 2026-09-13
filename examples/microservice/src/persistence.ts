/**
 * Инфраструктура хранения: соединение и слои транзакции.
 *
 * Оба — значения пакета `@nestlingjs/drizzle.pg`. Приложение не пишет ни
 * ресурса пула, ни шага-моста: транзакция запроса и хранилище обязаны
 * быть на одном соединении, поэтому их везёт один пакет.
 */

import { authed } from './auth.js';
import { observability } from './observability.js';
import { schema } from './schema.js';

import { compose } from '@nestlingjs/app';
import { drizzlePg } from '@nestlingjs/drizzle.pg';

/**
 * Соединение с базой.
 *
 * Экземпляр один, поэтому имени у него нет: ключи читаются как
 * `DATABASE_URL` и `DATABASE_POOL_MAX`, а переменная транзакции
 * называется `tx`. Второе соединение объявлялось бы вторым вызовом с
 * полем `name`.
 */
export const db = drizzlePg({ schema });

/**
 * Слой транзакции поверх `authed`.
 *
 * Транзакция открывается пайплайном, а не колбэком `db.transaction(cb)`:
 * снаружи колбэка транзакции нет, и репозиторий её не прочитал бы. Слой
 * коммитит на успехе, откатывает на отказе и возвращает соединение в пул
 * на любом исходе.
 */
export const transactional = compose(authed, db.transaction());

/**
 * Слой транзакции без проверки Bearer-токена.
 *
 * Его берёт вход, подлинность которого доказана не Bearer-токеном: webhook
 * подписан секретом. Наблюдаемость остаётся — он пишет ту же строку
 * аудита, что и остальные endpoint'ы.
 */
export const observed = compose(observability, db.transaction());
