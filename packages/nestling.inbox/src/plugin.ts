/**
 * Плагин `inbox(options)` — форма, которой пакет отдаётся приложению.
 *
 * Плагин, а не механизм: единица остаётся функцией, возвращающей
 * значение. Роль даёт ровно две вещи — своё поле корня (`plugins:`) и
 * правило «к плагину обращаются DI-токенами».
 */

import { InboxClaimUnit, makeInboxLayer } from './claim.js';
import type { InboxConfigValues } from './config.js';
import { InboxConfig, inboxConfigKeys } from './config.js';
import { InboxSweeper, InboxSweeper$ } from './sweeper.js';
import type { InboxStore } from './types.js';

import type {
  AnyContextVar,
  ConfigKeys,
  CtxReader,
  EmptyInput,
  EndpointFilter,
  Logger,
  Pipeline,
  Plugin,
  Policy,
} from '@nestlingjs/app';
import { Ctx, everyEndpoint, Logger$, makePlugin } from '@nestlingjs/app';
import type {
  InjectionToken,
  ModuleProvider,
  ResourceProviderDefinition,
} from '@nestlingjs/container';
import { factoryProvider } from '@nestlingjs/container';

/** Слой приёма: пайплайн, которому ещё нужен инстанс юнита отметки */
export type InboxLayer = Pipeline<
  EmptyInput,
  EmptyInput & { idempotencyKey: string },
  typeof InboxClaimUnit
>;

/** Словарь объявления плагина */
export interface InboxOptions {
  /**
   * Переменная контекста с транзакцией.
   *
   * Объявляет её приложение своим типом: пакет транзакцией не управляет и
   * ни одного метода на ней не вызывает. Слой приёма композируется внутрь
   * слоя, который эту переменную кладёт.
   */
  readonly transaction: AnyContextVar;

  /** DI-токен адаптера хранилища; адаптер поставляет приложение */
  readonly store: InjectionToken<InboxStore>;
}

/** Плагин приёма: обычный плагин плюс слой, ключи секции и политика */
export interface InboxPlugin extends Plugin {
  /**
   * Слой приёма — одно неизменяемое значение.
   *
   * Подписчик композирует его внутрь слоя транзакции:
   * `compose(db.transaction(), appInbox.layer)`.
   */
  readonly layer: InboxLayer;

  /** Ключи секции конфигурации пакета — для `config:` в корне */
  readonly keys: ConfigKeys;

  /**
   * Политика: каждый endpoint под фильтром композирован от слоя приёма.
   *
   * Нарушение останавливает сборку на фазе ASSEMBLE — до фазы INIT и до
   * открытия сокета. Какие endpoint'ы обязаны дедуплицировать, знает
   * приложение, поэтому фильтр задаёт корень.
   *
   * @param filter - Сужение множества endpoint'ов; без него — все
   * @param label - Метка для диагностики; без неё слой называется общим
   * словом
   *
   * @example
   * ```typescript
   * policies: [appInbox.requiresInbox({ transport: BusTransport$ }, 'inbox')],
   * ```
   */
  requiresInbox(filter?: EndpointFilter, label?: string): Policy;
}

/** Проверяет словарь объявления; всё — до создания единого значения */
function assertOptions(options: InboxOptions): void {
  if (typeof options.transaction?.key !== 'string') {
    throw new TypeError(
      `inbox({ transaction }): expected a context variable value declared ` +
        `with contextVar<T>()('key'), not a key. The package reads the ` +
        `transaction through that variable and passes it to the store as is.`,
    );
  }

  if (options.store === undefined || options.store === null) {
    throw new TypeError(
      `inbox({ store }): expected the DI token of the store adapter. The ` +
        `adapter belongs to the application: it and the transaction must ` +
        `live on one connection.`,
    );
  }
}

/**
 * Объявляет плагин транзакционного приёма.
 *
 * Значение создаётся композиционным корнем **один раз**: слой сравнивается
 * политикой по ссылке, и второй вызов `inbox(...)` дал бы другой слой.
 *
 * @param options - Переменная транзакции и DI-токен хранилища
 * @returns Плагин со слоем, ключами секции и политикой предпосылки
 *
 * @example
 * ```typescript
 * export const appInbox = inbox({
 *   transaction: db.tx,
 *   store: inboxStore.token,
 * });
 * ```
 */
export function inbox(options: InboxOptions): InboxPlugin {
  assertOptions(options);

  const layer = makeInboxLayer();

  const claim = factoryProvider(
    InboxClaimUnit,
    (store: InboxStore, transaction: CtxReader<unknown>, logger: Logger) =>
      new InboxClaimUnit(store, transaction, logger),
    [options.store, Ctx(options.transaction), Logger$('nestling:inbox')],
  );

  const sweeper: ResourceProviderDefinition<InboxSweeper> = {
    provide: InboxSweeper$,
    deps: [options.store, InboxConfig, Logger$('nestling:inbox')],
    acquire: (store: InboxStore, config: InboxConfigValues, logger: Logger) =>
      InboxSweeper.acquire({ store, config, logger }),
    release: (value: InboxSweeper) => value.release(),
  };

  const providers: ModuleProvider[] = [claim, sweeper];

  const plugin = makePlugin({ name: '@nestlingjs/inbox', providers });

  return Object.freeze({
    ...plugin,
    layer,
    keys: inboxConfigKeys,
    requiresInbox: (filter: EndpointFilter = {}, label?: string): Policy =>
      label === undefined
        ? everyEndpoint(filter).hasLayer(layer)
        : everyEndpoint(filter).hasLayer(layer, label),
  });
}
