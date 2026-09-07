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

import type { Schema } from '@common/misc';
import { SchemaValidationError, validateSync } from '@common/misc';
import type { CtxReader } from '@nestling/app';
import {
  BadRequest,
  collectPropagatedContext,
  describeForm,
} from '@nestling/app';
import type { Token } from '@nestling/container';
import { makeTokenFamily } from '@nestling/container';
import type {
  AnyOperation,
  Emitter,
  EmittingOperation,
} from '@nestling/operations';

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
 * Значение имеет тот же тип `Emitter<C>`, что и `Operation.emitter`,
 * поэтому тело хендлера от замены DI-токена не меняется. Меняется семантика
 * `emit`: промис завершается по факту записи в хранилище, а не по факту
 * доставки — публикует запись relay после коммита.
 *
 * Операция вида `request` сюда не проходит: у неё есть вызывающая
 * сторона `.caller`, а откладывать запрос-ответ до коммита нечем.
 *
 * @param operation - Операция вида `command` или `event`
 * @returns DI-токен со значением `Emitter<C>`
 *
 * @example
 * ```typescript
 * @Handler([outboxed(UserCreated), UsersRepository$])
 * export class CreateUserHandler {
 *   constructor(
 *     private readonly userCreated: Emitter<typeof UserCreated>,
 *     private readonly users: UsersRepository,
 *   ) {}
 * }
 * ```
 */
export const outboxed = <C extends EmittingOperation<any, any, any, any>>(
  operation: C,
): Token<Emitter<C>> =>
  OutboxedFamily(operation.name) as unknown as Token<Emitter<C>>;

/**
 * Как записи получают раздел.
 *
 * Функция композиции, а не аргумент `emit`: тип `meta` задаёт ядро
 * (`PortMeta`/`CommandMeta`), и лишнего поля в нём не выразить.
 *
 * @returns Ключ раздела или `undefined`, если запись ничем не упорядочена
 */
export type PartitionKeyOf = (
  payload: unknown,
  operation: AnyOperation,
) => string | undefined;

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

  /** Как записи получают раздел; без неё раздела нет ни у одной */
  readonly partitionKey?: PartitionKeyOf;
}

/**
 * Строит транзакционный эмиттер операции.
 *
 * @internal Вызывается рецептом семейства
 */
export function makeOutboxEmitter(
  operation: AnyOperation,
  context: OutboxEmitterContext,
): Emitter<any> {
  const { store, transaction, transactionKey, partitionKey } = context;

  return {
    async emit(payload?: unknown) {
      const input = validatePayload(operation, payload);
      const tx = transaction.peek();

      if (tx === undefined) {
        throw new OutboxTransactionMissingError(operation.name, transactionKey);
      }

      const propagated = collectPropagatedContext();
      const partition = partitionKey?.(input, operation);

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
