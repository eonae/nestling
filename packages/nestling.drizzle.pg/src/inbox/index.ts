/**
 * `@nestlingjs/drizzle.pg/inbox` — адаптер `InboxStore` на drizzle.
 *
 * Подпуть, а не корневой барель: `@nestlingjs/inbox` объявлен
 * необязательной peer-зависимостью, и приложение без него ставит пакет и
 * о хранилище отметок не знает.
 */

export { PgInboxTransactionError } from './errors.js';
export { pgInboxStore } from './plugin.js';
export type { PgInboxStoreOptions, PgInboxStorePlugin } from './plugin.js';
export { PgInboxStore } from './store.js';
export { DEFAULT_INBOX_TABLE, inboxDdl, inboxTable } from './table.js';
export type { InboxTable } from './table.js';
