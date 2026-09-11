/**
 * `@nestlingjs/drizzle.pg` — соединение с PostgreSQL, транзакция запроса и
 * адаптер хранилища outbox'а поверх drizzle-orm.
 *
 * Satellite-пакет: ни строки в ядре. Всё, из чего он собран, — публичные
 * примитивы: семейство конфиг-секций и переменные контекста
 * (`@nestlingjs/app`), ресурс с `acquire`/`release` и пробой
 * (`@nestlingjs/container`), пайплайн и политика.
 *
 * Драйвер везёт сателлит, а не ядро: слой транзакции и адаптер хранилища
 * обязаны жить на одном соединении, поэтому пакет, который везёт слой,
 * везёт и драйвер. `drizzle-orm` и `pg` — peer-зависимости: версию
 * выбирает приложение, и двух копий драйвера в процессе быть не должно.
 *
 * Адаптер `OutboxStore` живёт в подпуте `@nestlingjs/drizzle.pg/outbox`:
 * приложение без `@nestlingjs/outbox` ставит пакет и о хранилище не
 * знает.
 */

export { databaseConfigKeys } from './config.js';
export type { DatabaseConfigValues } from './config.js';
export { PgConnection, PgSession } from './connection.js';
export type {
  BeginOptions,
  IsolationLevel,
  PgSchema,
  PgTx,
} from './connection.js';
export {
  PgConnectionFailedError,
  PgDuplicateConnectionError,
} from './errors.js';
export { drizzlePg } from './plugin.js';
export type {
  DrizzlePgOptions,
  DrizzlePgPlugin,
  TxBridgeClass,
  TxLayer,
  TxLayerInput,
} from './plugin.js';
