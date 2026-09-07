/**
 * `@nestling/outbox` — транзакционный emit.
 *
 * **Предпосылка: транзакцию открывает и закрывает приложение.** Пакет её
 * не создаёт, не коммитит и не откатывает — он читает её из переменной
 * контекста и передаёт хранилищу непрозрачно. Поэтому идиома
 * `db.transaction(cb)` не подходит: снаружи колбэка транзакции нет, и
 * атомарность недостижима в принципе. Транзакция открывается пайплайном,
 * репозиторий читает её из контекста.
 *
 * Satellite-пакет: ни строки в ядре. Всё, из чего он собран, — публичные
 * примитивы: семейства DI-токенов и переменные контекста с их ридерами
 * (`@nestling/app`), ресурс с `acquire`/`release` и хук `@OnStart`
 * (`@nestling/container`), интерфейс шины, операции и `makePlugin`.
 *
 * Наружу уходят пять вещей: плагин, DI-токен транзакционного эмиттера,
 * типы хранилища с реализацией в памяти, relay со своим DI-токеном и две
 * `event`-операции, которыми пакет публикует факты.
 */

export { outboxConfigKeys } from './config.js';
export type { OutboxConfigValues } from './config.js';
export { outboxed } from './emitter.js';
export type { PartitionKeyOf } from './emitter.js';
export { OutboxTransactionMissingError } from './errors.js';
export { InMemoryOutboxStore } from './memory-store.js';
export type {
  OutboxRecordSnapshot,
  StagingTransaction,
} from './memory-store.js';
export { OutboxPublished, OutboxStuck } from './operations.js';
export type { OutboxPublishedFact, OutboxStuckFact } from './operations.js';
export { outbox } from './plugin.js';
export type { OutboxOptions, OutboxPlugin } from './plugin.js';
export { OutboxRelay, OutboxRelay$ } from './relay.js';
export type { OutboxDrainReport, OutboxRelayOptions } from './relay.js';
export type {
  ClaimedRecord,
  OutboxClaimOptions,
  OutboxRecord,
  OutboxSettlement,
  OutboxStore,
} from './types.js';
