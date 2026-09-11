/**
 * Плагин `outbox(options)` — форма, которой пакет отдаётся приложению.
 *
 * Плагин, а не механизм: единица остаётся функцией, возвращающей
 * значение. Роль даёт ровно две вещи — своё поле корня (`plugins:`) и
 * правило «к плагину обращаются DI-токенами».
 */

import type { OutboxConfigValues } from './config.js';
import { OutboxConfig } from './config.js';
import { makeOutboxEmitter, OutboxedFamily } from './emitter.js';
import { OutboxPublished, OutboxStuck } from './operations.js';
import { OutboxRelay, OutboxRelay$ } from './relay.js';
import type { OutboxStore } from './types.js';

import type {
  AnyContextVar,
  CtxReader,
  EndpointFilter,
  IMessageBus,
  Logger,
  Plugin,
  Policy,
} from '@nestlingjs/app';
import {
  Ctx,
  everyEndpoint,
  Logger$,
  makePlugin,
  MessageBus$,
} from '@nestlingjs/app';
import type {
  InjectionToken,
  ModuleProvider,
  ResourceProviderDefinition,
} from '@nestlingjs/container';
import {
  factoryProvider,
  familyProvider,
  makeToken,
} from '@nestlingjs/container';
import type {
  AnyOperation,
  Emitter,
  EmittingOperation,
} from '@nestlingjs/operations';

/** Операция, у которой есть транзакционный эмиттер */
type OutboxableOperation = EmittingOperation<any, any, any, any>;

/** Словарь объявления плагина */
export interface OutboxOptions {
  /**
   * Переменная контекста с транзакцией.
   *
   * Объявляет её приложение своим типом: пакет транзакцией не управляет и
   * ни одного метода на ней не вызывает. Она же — предмет политики
   * {@link OutboxPlugin.requiresTransaction}.
   */
  readonly transaction: AnyContextVar;

  /** DI-токен адаптера хранилища; адаптер поставляет приложение */
  readonly store: InjectionToken<OutboxStore>;

  /**
   * Операции, у которых есть транзакционный эмиттер.
   *
   * Список явный: рецепту семейства нужна сама операция — схема входа для
   * проверки payload и имя subject'а. Реестра, который наполнялся бы
   * вызовами `outboxed(Op)` при импорте, у пакета нет.
   */
  readonly operations: readonly OutboxableOperation[];
}

/** Плагин outbox'а: обычный плагин плюс политика предпосылки */
export interface OutboxPlugin extends Plugin {
  /**
   * Политика: каждый endpoint под фильтром объявил переменную транзакции.
   *
   * Нарушение останавливает сборку на фазе ASSEMBLE — до фазы INIT и до
   * открытия сокета. Какие endpoint'ы обязаны быть в транзакции, знает
   * приложение, поэтому фильтр задаёт корень.
   *
   * @param filter - Сужение множества endpoint'ов; без него — все
   * @param label - Метка для диагностики; без неё называется ключ
   * переменной
   *
   * @example
   * ```typescript
   * policies: [
   *   appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
   * ],
   * ```
   */
  requiresTransaction(filter?: EndpointFilter, label?: string): Policy;
}

/**
 * DI-токен шины для relay.
 *
 * Алиас `MessageBus$` ради имени потребителя: в ошибке о недостающей
 * зависимости relay назван пакетом, а не классом. Первую починку —
 * подключить транспорт шины — печатает ядро подсказкой `MessageBus$`;
 * вторую, убрать плагин, знает только пакет, и она стоит подсказкой здесь.
 * Идентификатор остаётся именем.
 */
const OutboxBus$ = makeToken<IMessageBus>('@nestlingjs/outbox relay', {
  hint: 'or remove the outbox plugin',
});

/** Проверяет словарь объявления; всё — до создания единого значения */
function assertOptions(options: OutboxOptions): void {
  if (typeof options.transaction?.key !== 'string') {
    throw new TypeError(
      `outbox({ transaction }): expected a context variable value declared ` +
        `with contextVar<T>()('key'), not a key. The package reads the ` +
        `transaction through that variable and passes it to the store as is.`,
    );
  }

  if (!Array.isArray(options.operations)) {
    throw new TypeError(
      `outbox({ operations }): expected an array of operations declared ` +
        `with makeCommand or makeEvent.`,
    );
  }

  for (const operation of options.operations) {
    if (operation?.kind !== 'command' && operation?.kind !== 'event') {
      throw new TypeError(
        `outbox({ operations }): '${String(
          (operation as AnyOperation | undefined)?.name,
        )}' is not a command or an event. A request-reply has a live caller ` +
          `waiting for the answer, so there is nothing to defer until commit.`,
      );
    }
  }
}

/**
 * Объявляет плагин транзакционного outbox'а.
 *
 * Значение создаётся композиционным корнем **один раз**: рецепт семейства
 * регистрируется однажды, и второй вызов `outbox(...)` в том же
 * приложении контейнер отклонит как повторную регистрацию.
 *
 * @param options - Переменная транзакции, DI-токен хранилища, операции
 * @returns Плагин с политикой предпосылки
 *
 * @example
 * ```typescript
 * export const appOutbox = outbox({
 *   transaction: Tx,
 *   store: OutboxStore$,
 *   operations: [UserCreated, OrderPlaced],
 * });
 * ```
 */
export function outbox(options: OutboxOptions): OutboxPlugin {
  assertOptions(options);

  const declared = new Map<string, OutboxableOperation>(
    options.operations.map((operation) => [operation.name, operation]),
  );

  const transactionKey = options.transaction.key;

  const emitters = familyProvider(OutboxedFamily, (name) => {
    const operation = declared.get(name);

    if (!operation) {
      throw new Error(
        `Operation '${name}' is injected as outboxed(…), but it is not ` +
          `listed in outbox({ operations }). Add it there: the recipe needs ` +
          `the operation itself — its input schema to check the payload and ` +
          `its name for the subject.`,
      );
    }

    return {
      provide: OutboxedFamily(name),
      useFactory: (store: OutboxStore, transaction: CtxReader<unknown>) =>
        makeOutboxEmitter(operation, { store, transaction, transactionKey }),
      deps: [options.store, Ctx(options.transaction)],
    };
  });

  const relay: ResourceProviderDefinition<OutboxRelay> = {
    provide: OutboxRelay$,
    deps: [
      options.store,
      OutboxBus$,
      OutboxConfig,
      Logger$('nestling:outbox'),
      OutboxPublished.emitter,
      OutboxStuck.emitter,
    ],
    acquire: (
      store: OutboxStore,
      bus: IMessageBus,
      config: OutboxConfigValues,
      logger: Logger,
      published: Emitter<typeof OutboxPublished>,
      stuck: Emitter<typeof OutboxStuck>,
    ) => OutboxRelay.acquire({ store, bus, config, logger, published, stuck }),
    release: (value: OutboxRelay) => value.release(),
  };

  const providers: ModuleProvider[] = [
    emitters,
    factoryProvider(OutboxBus$, (bus: IMessageBus) => bus, [MessageBus$]),
    relay,
  ];

  const plugin = makePlugin({ name: '@nestlingjs/outbox', providers });

  return Object.freeze({
    ...plugin,
    requiresTransaction: (
      filter: EndpointFilter = {},
      label?: string,
    ): Policy =>
      label === undefined
        ? everyEndpoint(filter).hasVar(options.transaction)
        : everyEndpoint(filter).hasVar(options.transaction, label),
  });
}
