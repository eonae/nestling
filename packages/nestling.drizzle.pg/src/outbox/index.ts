/**
 * `@nestlingjs/drizzle.pg/outbox` — адаптер `OutboxStore` на drizzle.
 *
 * Подпуть, а не корневой барель: `@nestlingjs/outbox` объявлен
 * необязательной peer-зависимостью, и приложение без него ставит пакет и
 * о хранилище не знает.
 */

export { PgOutboxTransactionError } from './errors.js';
export { pgOutboxStore } from './plugin.js';
export type { PgOutboxStoreOptions, PgOutboxStorePlugin } from './plugin.js';
export { PgOutboxStore } from './store.js';
export { DEFAULT_OUTBOX_TABLE, outboxDdl, outboxTable } from './table.js';
export type { OutboxTable } from './table.js';
