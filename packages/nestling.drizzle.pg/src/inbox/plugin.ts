/**
 * `pgInboxStore(connection)` — плагин с DI-токеном хранилища отметок.
 *
 * Хранилище живёт на том же соединении, что и транзакция запроса: иначе
 * строку отметки и строку бизнес-изменения одной транзакцией не
 * закоммитить.
 */

import type { PgConnection, PgSchema } from '../connection.js';
import type { DrizzlePgPlugin } from '../plugin.js';

import { PgInboxStore } from './store.js';
import { DEFAULT_INBOX_TABLE } from './table.js';

import type { Plugin } from '@nestlingjs/app';
import { makePlugin } from '@nestlingjs/app';
import type { Token } from '@nestlingjs/container';
import { factoryProvider, makeToken } from '@nestlingjs/container';
import type { InboxStore } from '@nestlingjs/inbox';

/** Словарь объявления адаптера */
export interface PgInboxStoreOptions {
  /** Имя таблицы отметок; умолчание — `inbox` */
  readonly table?: string;
}

/** Значение адаптера: плагин плюс DI-токен хранилища */
export interface PgInboxStorePlugin extends Plugin {
  /** DI-токен хранилища — его принимает поле `store` плагина приёма */
  readonly token: Token<InboxStore>;
}

/**
 * Объявляет адаптер хранилища отметок на соединении.
 *
 * @param connection - Значение соединения, вернувшееся из `drizzlePg`
 * @param options - Имя таблицы отметок
 *
 * @example
 * ```typescript
 * export const inboxStore = pgInboxStore(db);
 *
 * export const appInbox = inbox({
 *   transaction: db.tx,
 *   store: inboxStore.token,
 * });
 * ```
 */
export function pgInboxStore<S extends PgSchema, N extends string>(
  connection: DrizzlePgPlugin<S, N>,
  options: PgInboxStoreOptions = {},
): PgInboxStorePlugin {
  const table = options.table ?? DEFAULT_INBOX_TABLE;
  const name = `${connection.name}/inbox`;
  const token = makeToken<InboxStore>(`${connection.connection.id}:inbox`);

  const plugin = makePlugin({
    name,
    providers: [
      factoryProvider(
        token,
        (value: PgConnection<S>) => new PgInboxStore(value, table),
        [connection.connection],
      ),
    ],
    dependsOn: [connection],
  });

  return Object.freeze({ ...plugin, token });
}
