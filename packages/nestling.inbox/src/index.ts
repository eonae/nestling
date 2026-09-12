/**
 * `@nestlingjs/inbox` — транзакционный приём.
 *
 * Слой пакета читает ключ идемпотентности из конверта сообщения и
 * отмечает сообщение обработанным транзакцией вызывающего. Повтор до
 * хендлера не доходит: юнит отметки завершает endpoint досрочным успехом.
 *
 * **Предпосылка: транзакцию открывает и закрывает приложение.** Пакет её
 * не создаёт, не коммитит и не откатывает — он читает её из переменной
 * контекста и передаёт хранилищу непрозрачно. Поэтому слой приёма
 * композируется внутрь слоя транзакции, а не наоборот.
 *
 * Satellite-пакет поверх публичных примитивов: переменные контекста и их
 * ридеры, конструктор пайплайна, словарь политик (`@nestlingjs/app`),
 * роль ресурса и хук `@OnStart` (`@nestlingjs/container`).
 *
 * Наружу уходят четыре вещи: плагин, типы хранилища с реализацией в
 * памяти, уборщик со своим DI-токеном и ключи секции конфигурации.
 */

export { inboxConfigKeys } from './config.js';
export type { InboxConfigValues } from './config.js';
export { InboxKeyMissingError } from './errors.js';
export { readIdempotencyKey } from './key.js';
export { InMemoryInboxStore } from './memory-store.js';
export type { RollbackAwareTransaction } from './memory-store.js';
export { inbox } from './plugin.js';
export type { InboxLayer, InboxOptions, InboxPlugin } from './plugin.js';
export { InboxSweeper, InboxSweeper$ } from './sweeper.js';
export type { InboxSweeperOptions } from './sweeper.js';
export type {
  InboxClaim,
  InboxMark,
  InboxStore,
  InboxSweepOptions,
} from './types.js';
