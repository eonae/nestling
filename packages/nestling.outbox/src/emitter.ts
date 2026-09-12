/**
 * Транзакционный эмиттер: семейство DI-токенов `outboxed(Op)` и его
 * рецепт.
 *
 * DI-токен ядра `Operation.emitter` остаётся на месте и работает как прежде.
 * Выбор между транзакционной и прямой отправкой виден в списке
 * зависимостей хендлера — одной строкой, которую читают там же, где
 * читают сам вызов.
 */

import { OutboxTransactionMissingError } from './errors.js';
import type { OutboxRecord, OutboxStore } from './types.js';

import type { CtxReader } from '@nestlingjs/app';
import {
  BadRequest,
  collectPropagatedContext,
  describeForm,
} from '@nestlingjs/app';
import type { Schema } from '@nestlingjs/common.misc';
import { SchemaValidationError, validateSync } from '@nestlingjs/common.misc';
import type { Token } from '@nestlingjs/container';
import { makeTokenFamily } from '@nestlingjs/container';
import type {
  AnyOperation,
  Emitter,
  EmittingOperation,
  MetaOf,
} from '@nestlingjs/operations';

/** Операция, у которой есть транзакционный эмиттер */
type OutboxableOperation = EmittingOperation<any, any, any, any>;

/**
 * Словарь `meta` транзакционного эмиттера: словарь ядра плюс раздел.
 *
 * Раздел называет место вызова — тот, кто знает, чем упорядочена запись.
 * Поле пакета в конверт транспорта не попадает: его читает только
 * эмиттер, который его и объявил.
 */
export type OutboxEmitMeta<C extends OutboxableOperation> = MetaOf<C> & {
  /**
   * Раздел записи: записи одного раздела публикуются в порядке создания.
   * Между разделами порядок не гарантируется; запись без раздела не
   * упорядочена ничем.
   */
  readonly partitionKey?: string;
};

/**
 * Транзакционный эмиттер: эмиттер ядра с расширенным словарём `meta`.
 *
 * Значение присваивается переменной типа `Emitter<C>`, поэтому хендлер,
 * которому раздел не нужен, объявляет зависимость прежним типом.
 */
export type OutboxEmitter<C extends OutboxableOperation> = Emitter<
  C,
  OutboxEmitMeta<C>
>;

/**
 * Семейство транзакционных эмиттеров: один член на операцию.
 *
 * Наружу отдаётся типизированная функция {@link outboxed}, поэтому имя
 * операции не пишется руками, а тип значения выводится из самой операции.
 *
 * @internal Рецепт регистрирует плагин `outbox(...)`
 */
export const OutboxedFamily = makeTokenFamily<Emitter<any>, [name: string]>(
  'Outboxed',
);

/**
 * DI-токен транзакционного эмиттера операции.
 *
 * Значение — {@link OutboxEmitter}: эмиттер ядра, чей словарь `meta`
 * дополнен разделом. Оно присваивается `Emitter<C>`, поэтому тело
 * хендлера от замены DI-токена не меняется. Меняется семантика `emit`:
 * промис завершается по факту записи в хранилище, а не по факту доставки
 * — публикует запись relay после коммита.
 *
 * Операция вида `request` сюда не проходит: у неё есть вызывающая
 * сторона `.caller`, а откладывать запрос-ответ до коммита нечем.
 *
 * @param operation - Операция вида `command` или `event`
 * @returns DI-токен со значением `OutboxEmitter<C>`
 *
 * @example
 * ```typescript
 * @Handler([outboxed(UserCreated), UsersRepository$])
 * export class CreateUserHandler {
 *   constructor(
 *     private readonly userCreated: OutboxEmitter<typeof UserCreated>,
 *     private readonly users: UsersRepository,
 *   ) {}
 *
 *   async handle(input: CreateUserInput) {
 *     const user = await this.users.insert(input);
 *     // Раздел — идентификатор пользователя: его события едут по порядку
 *     await this.userCreated.emit(user, { partitionKey: user.id });
 *   }
 * }
 * ```
 */
export const outboxed = <C extends OutboxableOperation>(
  operation: C,
): Token<OutboxEmitter<C>> =>
  OutboxedFamily(operation.name) as unknown as Token<OutboxEmitter<C>>;

/** Схема-лист формы `input` или `undefined`, если проверять нечем */
function leafSchemaOf(io: unknown): Schema | undefined {
  const form = describeForm(io);

  if (form.kind !== 'value' || !form.leaf) {
    return undefined;
  }

  return form.leaf === 'binary' || form.leaf === 'text'
    ? undefined
    : (form.leaf as Schema);
}

/**
 * Проверяет payload схемой операции.
 *
 * Отказ той же формы, что у обычного `emit`: `BadRequest` с деталями
 * схемы. Проверка стоит до чтения транзакции, чтобы ошибка схемы падала
 * в транзакции вызывающего, — в relay откатывать уже нечего.
 */
function validatePayload(operation: AnyOperation, payload: unknown): unknown {
  const schema = leafSchemaOf(operation.input);

  if (!schema) {
    return payload;
  }

  try {
    return validateSync(schema, payload, 'Payload validation failed');
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw BadRequest(error.issues, { cause: error });
    }

    throw error;
  }
}

/** Что нужно эмиттеру помимо самой операции */
export interface OutboxEmitterContext {
  /** Хранилище, поставленное приложением */
  readonly store: OutboxStore;

  /** Ридер переменной транзакции */
  readonly transaction: CtxReader<unknown>;

  /** Ключ переменной транзакции — им называется починка в тексте ошибки */
  readonly transactionKey: string;
}

/**
 * Строит транзакционный эмиттер операции.
 *
 * @internal Вызывается рецептом семейства
 */
export function makeOutboxEmitter(
  operation: AnyOperation,
  context: OutboxEmitterContext,
): OutboxEmitter<any> {
  const { store, transaction, transactionKey } = context;

  return {
    async emit(payload?: unknown, meta?: { partitionKey?: string }) {
      const input = validatePayload(operation, payload);
      const tx = transaction.peek();

      if (tx === undefined) {
        throw new OutboxTransactionMissingError(operation.name, transactionKey);
      }

      const propagated = collectPropagatedContext();
      // Раздел называет место вызова; ядро этого поля не знает и в конверт
      // его не кладёт
      const partition = meta?.partitionKey;

      const record: OutboxRecord = {
        id: crypto.randomUUID(),
        subject: operation.name,
        payload: input,
        durable: operation.durable === true,
        createdAt: Date.now(),
        ...(partition === undefined ? {} : { partitionKey: partition }),
        ...(propagated === undefined ? {} : { context: propagated }),
      };

      await store.append(tx, [record]);
    },
  };
}
