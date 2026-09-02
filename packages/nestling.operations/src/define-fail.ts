import type { AnyFail } from './result.js';
import { Fail, isFail } from './result.js';
import type { ErrorStatus } from './status.js';

import type { StandardSchemaV1 } from '@common/misc';
import { validateSync } from '@common/misc';

/**
 * Контекст ответа в том виде, в каком его видит предикат `is`.
 *
 * Это структурный тип, а не `ResponseContext` из `@nestling/pipeline`:
 * пакет операций не импортирует серверный код. `ResponseContext`
 * удовлетворяет этому типу, поэтому сужение в `.catch`-юните работает.
 *
 * Тип принимает обе ветки `isSuccess`. Иначе перегрузка `is` не подошла бы
 * под `ResponseContext`, и вызов ушёл бы в вариант с `unknown`.
 */
export interface ResponseLike {
  readonly isSuccess: boolean;
  readonly value?: unknown;
}

/** Контекст ответа-ошибки, суженный до конкретного определения отказа */
export type FailResponseOf<TCode extends string, TDetails> = ResponseLike & {
  readonly isSuccess: false;
  readonly value: { readonly code: TCode; readonly details: TDetails };
};

/**
 * Бренд определения отказа: неперечислимое symbol-свойство.
 *
 * По нему проверка списка `errors` отличает определение от произвольной
 * функции или класса ошибки.
 */
const FAIL_DEFINITION_BRAND = Symbol.for('nestling:fail-definition');

/** Опции создания отказа: второй аргумент определения */
export interface FailCreateOptions {
  /** Исходная ошибка; в тело ответа не попадает */
  cause?: unknown;
}

/**
 * Отказ, созданный определением. Если у определения есть схема, поле
 * `details` обязательно.
 *
 * У класса `Fail` поле `details` опционально, потому что он описывает и
 * анонимный отказ. Определение гарантирует детали конструктором, и `.is()`
 * возвращает это сужение, чтобы в `.catch` не приходилось проверять
 * `undefined`.
 */
export type DeclaredFail<TCode extends string, TDetails> = [TDetails] extends [
  undefined,
]
  ? Fail<TCode, undefined>
  : Fail<TCode, TDetails> & { readonly details: TDetails };

/**
 * Свойства определения отказа: всё, кроме самого вызова.
 */
export interface FailDefinitionProps<
  TCode extends string = string,
  TDetails = unknown,
> {
  /** Машинный код; по нему отказ распознаётся */
  readonly code: TCode;

  /** Статус ответа, не зависящий от транспорта */
  readonly status: ErrorStatus;

  /** Схема деталей, если объявлена (нужна OpenAPI и клиентам) */
  readonly schema?: StandardSchemaV1;

  /** @internal Фантомное поле: из него выводится тип `E` списка `errors` */
  readonly $fail?: DeclaredFail<TCode, TDetails>;

  /**
   * Проверяет, что значение — отказ этого определения. Сравнивает `code`,
   * а не `instanceof`.
   *
   * Две перегрузки: код отказа приходит либо значением `Fail` (в том числе
   * разобранным из JSON, без прототипа), либо контекстом ответа-ошибки,
   * который видит `.catch`-юнит.
   */
  is(value: ResponseLike): value is FailResponseOf<TCode, TDetails>;
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
 * Определение отказа в любой форме: тип элемента списка `errors`.
 *
 * Описывает только свойства, без сигнатуры вызова: декларации не важно,
 * сколько аргументов принимает конструктор.
 *
 * Отдельный интерфейс, а не `FailDefinitionProps<string, any>`: `any` в
 * позиции деталей сводит условный `DeclaredFail` к ветке «без деталей», и
 * определения со схемой перестали бы подходить под тип списка.
 */
export interface AnyFailDefinition {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly schema?: StandardSchemaV1;
  readonly $fail?: AnyFail;
  is(value: unknown): boolean;
}

/** Тип отказа, который создаёт определение */
export type FailOf<D extends AnyFailDefinition> = Exclude<
  D['$fail'],
  undefined
>;

/**
 * Объединение отказов из списка `errors`: множество `E` хендлера.
 *
 * Для пустого списка даёт `never`: endpoint без объявленных отказов не
 * может вернуть отказ.
 */
export type FailsOf<E extends readonly AnyFailDefinition[]> = Exclude<
  E[number]['$fail'],
  undefined
>;

/** Спецификация определения со схемой деталей */
export interface FailSpecWithDetails<S extends StandardSchemaV1> {
  status: ErrorStatus;

  /**
   * Сообщение отказа: строка или функция от деталей, прошедших схему.
   * Других аргументов у функции нет: все данные отказа лежат в `details`.
   */
  message: string | ((details: StandardSchemaV1.InferOutput<S>) => string);

  /** Схема деталей: любая Standard Schema v1 */
  details: S;
}

/** Спецификация определения без деталей */
export interface FailSpecWithoutDetails {
  status: ErrorStatus;
  message: string;
  details?: undefined;
}

/**
 * Проверяет, что значение создано `defineFail`.
 *
 * Используется при проверке списка `errors` в декларации и операции.
 */
export function isFailDefinition(value: unknown): value is AnyFailDefinition {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<symbol, unknown>)[FAIL_DEFINITION_BRAND] ===
      true
  );
}

/**
 * Проверяет, что значение — контекст ответа-ошибки
 * (`isSuccess === false`).
 */
function isErrorResponse(
  value: unknown,
): value is { isSuccess: false; value?: { code?: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isSuccess?: unknown }).isSuccess === false
  );
}

/**
 * Объявляет доменный отказ.
 *
 * Возвращает определение: вызываемое значение со свойствами `code`,
 * `status`, `schema` и предикатом `is`. Вызов определения создаёт `Fail`.
 * Определение ничего не регистрирует; на приложение оно влияет только
 * через список `errors` декларации.
 *
 * Отказ распознаётся по `code`, а не по `instanceof`: отказ, полученный по
 * сети, — обычный объект без прототипа.
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
