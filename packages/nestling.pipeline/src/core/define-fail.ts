import type { ErrorResponseContext, ResponseContext } from './types/context.js';
import type { AnyFail } from './result.js';
import { Fail, isFail } from './result.js';
import type { ErrorStatus } from './status.js';

import type { StandardSchemaV1 } from '@common/misc';
import { validateSync } from '@common/misc';

/**
 * Symbol-бренд определения отказа.
 *
 * Неперечислимый, как и бренд декларации: определение остаётся обычным
 * вызываемым значением, но `errors:` может отличить его от произвольной
 * функции или класса ошибки, попавшего в список по недосмотру.
 */
const FAIL_DEFINITION_BRAND = Symbol.for('nestling:fail-definition');

/** Опции конструирования отказа (второй аргумент определения) */
export interface FailCreateOptions {
  /** Исходная ошибка; в тело ответа не попадает */
  cause?: unknown;
}

/**
 * Отказ определения: `details` обязателен, если схема объявлена.
 *
 * У класса `Fail` поле опционально — он описывает и анонимный отказ.
 * Определение же гарантирует детали конструктором, и `.is()` обязан это
 * сужение отдавать: иначе матчинг в `.catch` упирался бы в `undefined`.
 */
export type DeclaredFail<TCode extends string, TDetails> = [TDetails] extends [
  undefined,
]
  ? Fail<TCode, undefined>
  : Fail<TCode, TDetails> & { readonly details: TDetails };

/**
 * Свойства определения отказа — то, что несёт значение помимо
 * вызываемости.
 */
export interface FailDefinitionProps<
  TCode extends string = string,
  TDetails = unknown,
> {
  /** Машинный код: он же идентичность отказа */
  readonly code: TCode;

  /** Транспортно-нейтральный статус ответа */
  readonly status: ErrorStatus;

  /** Схема деталей, если объявлена (нужна OpenAPI и клиентам) */
  readonly schema?: StandardSchemaV1;

  /** @internal фантомное поле: из него выводится `E` списка `errors:` */
  readonly $fail?: DeclaredFail<TCode, TDetails>;

  /**
   * Предикат идентичности — **по коду, не по `instanceof`**.
   *
   * Две перегрузки, потому что код отказа доезжает до пользователя двумя
   * носителями: значением-отказом (в том числе разобранным из JSON, где
   * прототип потерян) и контекстом ответа-ошибки, который видит
   * `.catch`-юнит. Обе сужают ровно то, что действительно есть в рантайме.
   */
  is(value: ResponseContext): value is ErrorResponseContext & {
    value: { code: TCode; details: TDetails };
  };
  is(value: unknown): value is DeclaredFail<TCode, TDetails>;
}

/** Определение отказа со схемой деталей: конструктор принимает детали */
export interface FailDefinitionWithDetails<
  TCode extends string = string,
  TDetails = unknown,
> extends FailDefinitionProps<TCode, TDetails> {
  (
    details: TDetails,
    options?: FailCreateOptions,
  ): DeclaredFail<TCode, TDetails>;
}

/** Определение отказа без деталей: конструктор вызывается без аргументов */
export interface FailDefinitionWithoutDetails<TCode extends string = string>
  extends FailDefinitionProps<TCode, undefined> {
  (options?: FailCreateOptions): DeclaredFail<TCode, undefined>;
}

/**
 * Определение отказа в любой форме — тип элемента списка `errors:`.
 *
 * Намеренно описывает только свойства: вызываемость определения для
 * декларации несущественна, а требование её в типе списка заставило бы
 * ядро рассуждать об арности конструктора.
 *
 * Пишется отдельным интерфейсом, а не `FailDefinitionProps<string, any>`:
 * `any` в позиции деталей схлопнул бы условный `DeclaredFail` в ветку
 * «без деталей», и определения со схемой перестали бы подходить под тип
 * списка.
 */
export interface AnyFailDefinition {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly schema?: StandardSchemaV1;
  readonly $fail?: AnyFail;
  is(value: unknown): boolean;
}

/** Отказ, порождаемый определением */
export type FailOf<D extends AnyFailDefinition> = Exclude<
  D['$fail'],
  undefined
>;

/**
 * Юнион отказов списка `errors:` — множество `E` хендлера.
 *
 * Для пустого списка даёт `never`: ручка без объявленных отказов вернуть
 * отказ не может.
 */
export type FailsOf<E extends readonly AnyFailDefinition[]> = Exclude<
  E[number]['$fail'],
  undefined
>;

/** Словарь определения со схемой деталей */
export interface FailSpecWithDetails<S extends StandardSchemaV1> {
  status: ErrorStatus;

  /**
   * Сообщение отказа: строка либо функция **от валидированных деталей**.
   * Произвольных аргументов у сообщения нет — единственный источник
   * данных отказа это `details`.
   */
  message: string | ((details: StandardSchemaV1.InferOutput<S>) => string);

  /** Схема деталей: любая Standard Schema v1 */
  details: S;
}

/** Словарь определения без деталей */
export interface FailSpecWithoutDetails {
  status: ErrorStatus;
  message: string;
  details?: undefined;
}

/**
 * Проверяет, что значение создано `defineFail`.
 *
 * Используется проверкой списка `errors:` в точке создания декларации.
 */
export function isFailDefinition(value: unknown): value is AnyFailDefinition {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<symbol, unknown>)[FAIL_DEFINITION_BRAND] ===
      true
  );
}

/** Контекст ответа-ошибки как носитель кода */
function isErrorResponse(value: unknown): value is ErrorResponseContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isSuccess?: unknown }).isSuccess === false
  );
}

/**
 * Объявляет доменный отказ как значение.
 *
 * Возвращает **определение** — вызываемое значение-конструктор со
 * свойствами `code`, `status`, `schema` и предикатом `is`. Определение
 * ничего не регистрирует: на приложение оно влияет только через `errors:`
 * декларации.
 *
 * Идентичность отказа — код, а не `instanceof`: отказ, приехавший по
 * проводу, это данные, на которых класс мёртв.
 *
 * @example Отказ с деталями
 * ```typescript
 * export const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
 *   status: 'NOT_FOUND',
 *   details: z.object({ orderId: z.string() }),
 *   message: (d) => `Order ${d.orderId} not found`,
 * });
 *
 * throw OrderNotFound({ orderId: '42' });
 * throw OrderNotFound({ orderId: '42' }, { cause: dbError });
 * ```
 *
 * @example Отказ без деталей
 * ```typescript
 * export const EmailTaken = defineFail('EMAIL_TAKEN', {
 *   status: 'CONFLICT',
 *   message: 'Email already taken',
 * });
 *
 * throw EmailTaken();
 * ```
 *
 * @throws {Error} При конструировании: детали не прошли схему (текст
 * называет код отказа)
 */
export function defineFail<TCode extends string, S extends StandardSchemaV1>(
  code: TCode,
  spec: FailSpecWithDetails<S>,
): FailDefinitionWithDetails<TCode, StandardSchemaV1.InferOutput<S>>;
export function defineFail<TCode extends string>(
  code: TCode,
  spec: FailSpecWithoutDetails,
): FailDefinitionWithoutDetails<TCode>;
export function defineFail(
  code: string,
  spec: {
    status: ErrorStatus;
    message: string | ((details: unknown) => string);
    details?: StandardSchemaV1;
  },
): AnyFailDefinition {
  const { status, message, details: schema } = spec;

  const definition = (
    first?: unknown,
    second?: FailCreateOptions,
  ): Fail<string, unknown> => {
    // Со схемой первый аргумент — детали, без схемы — сразу опции.
    const details = schema
      ? validateSync(
          schema,
          first,
          `Fail '${code}': details do not match the declared schema`,
        )
      : undefined;
    const options = (schema ? second : (first as FailCreateOptions)) ?? {};

    const text = typeof message === 'function' ? message(details) : message;

    return new Fail<string, unknown>(status, text, {
      code,
      details,
      cause: options.cause,
    });
  };

  const props = {
    code,
    status,
    ...(schema ? { schema } : {}),
    is: (value: unknown): boolean => {
      if (isFail(value)) {
        return value.code === code;
      }
      if (isErrorResponse(value)) {
        return value.value?.code === code;
      }
      return false;
    },
  };

  Object.assign(definition, props);
  Object.defineProperty(definition, FAIL_DEFINITION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return definition as unknown as AnyFailDefinition;
}
