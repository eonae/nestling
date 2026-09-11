/**
 * `pgOutboxStore(connection)` — плагин с DI-токеном хранилища.
 *
 * Хранилище живёт на том же соединении, что и транзакция запроса: иначе
 * строку события и строку бизнес-изменения одной транзакцией не
 * закоммитить.
 */

import type { PgConnection, PgSchema } from '../connection.js';
import type { DrizzlePgPlugin } from '../plugin.js';

import { PgOutboxStore } from './store.js';
import { DEFAULT_OUTBOX_TABLE } from './table.js';

import type { Plugin } from '@nestlingjs/app';
import { makePlugin } from '@nestlingjs/app';
import type { Token } from '@nestlingjs/container';
import { factoryProvider, makeToken } from '@nestlingjs/container';
import type { OutboxStore } from '@nestlingjs/outbox';

/** Словарь объявления адаптера */
export interface PgOutboxStoreOptions {
  /** Имя таблицы записей; умолчание — `outbox` */
  readonly table?: string;
}

/** Значение адаптера: плагин плюс DI-токен хранилища */
export interface PgOutboxStorePlugin extends Plugin {
  /** DI-токен хранилища — его принимает поле `store` плагина outbox'а */
  readonly token: Token<OutboxStore>;
}

/**
 * Объявляет адаптер хранилища на соединении.
 *
 * @param connection - Значение соединения, вернувшееся из `drizzlePg`
 * @param options - Имя таблицы записей
 *
 * @example
 * ```typescript
 * export const outboxStore = pgOutboxStore(db);
 *
 * export const appOutbox = outbox({
 *   transaction: db.tx,
 *   store: outboxStore.token,
 *   operations: [UserCreated],
 * });
 * ```
 */
export function pgOutboxStore<S extends PgSchema, N extends string>(
  connection: DrizzlePgPlugin<S, N>,
  options: PgOutboxStoreOptions = {},
): PgOutboxStorePlugin {
  const table = options.table ?? DEFAULT_OUTBOX_TABLE;
  const name = `${connection.name}/outbox`;
  const token = makeToken<OutboxStore>(`${connection.connection.id}:outbox`);

  const plugin = makePlugin({
    name,
    providers: [
      factoryProvider(
        token,
        (value: PgConnection<S>) => new PgOutboxStore(value, table),
        [connection.connection],
      ),
    ],
    dependsOn: [connection],
  });

  return Object.freeze({ ...plugin, token });
}
