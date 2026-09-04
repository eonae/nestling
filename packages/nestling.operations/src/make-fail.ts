import type { AnyFail } from './result.js';
import { Fail, isFail } from './result.js';
import type { Category, FailCode } from './status.js';
import { assertFailCode, categoryOf } from './status.js';

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
export type FailResponseOf<TCode extends FailCode, TDetails> = ResponseLike & {
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
export type DeclaredFail<TCode extends FailCode, TDetails> = [
  TDetails,
] extends [undefined]
  ? Fail<TCode, undefined>
  : Fail<TCode, TDetails> & { readonly details: TDetails };

/**
 * Свойства определения отказа: всё, кроме самого вызова.
 */
export interface FailDefinitionProps<
  TCode extends FailCode = FailCode,
  TDetails = unknown,
> {
  /** Машинный код; по нему отказ распознаётся */
  readonly code: TCode;

  /** Категория: первый сегмент кода. Её транспорт переводит в свой статус */
  readonly category: Category;

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
  TCode extends FailCode = FailCode,
  TDetails = unknown,
> extends FailDefinitionProps<TCode, TDetails> {
  (
    details: TDetails,
    options?: FailCreateOptions,
  ): DeclaredFail<TCode, TDetails>;
}

/** Определение отказа без деталей: конструктор вызывается без аргументов */
export interface FailDefinitionWithoutDetails<TCode extends FailCode = FailCode>
  extends FailDefinitionProps<TCode, undefined> {
  (options?: FailCreateOptions): DeclaredFail<TCode, undefined>;
}

/**
 * Определение отказа в любой форме: тип элемента списка `errors`.
 *
 * Описывает только свойства, без сигнатуры вызова: декларации не важно,
 * сколько аргументов принимает конструктор.
 *
 * Отдельный интерфейс, а не `FailDefinitionProps<FailCode, any>`: `any` в
 * позиции деталей сводит условный `DeclaredFail` к ветке «без деталей», и
 * определения со схемой перестали бы подходить под тип списка.
 */
export interface AnyFailDefinition {
  readonly code: FailCode;
  readonly category: Category;
  readonly schema?: StandardSchemaV1;
  readonly $fail?: AnyFail;
  is(value: unknown): boolean;
}

/**
 * Тип отказа, который создаёт определение.
 *
 * @internal Публичная запись множества отказов — сами определения:
 * `Output<User, typeof UserNotFound>`.
 */
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

/**
 * Разворачивает элемент `E` в тип отказа: определение — в отказ, который
 * оно создаёт, готовый `Fail` — как есть.
 *
 * Условие одно и плоское: юнион определений раскладывается дистрибутивно.
 */
export type FailOfDef<D> = D extends AnyFailDefinition ? FailOf<D> : D;

/** Опции определения со схемой деталей */
export interface FailSpecWithDetails<S extends StandardSchemaV1> {
  /**
   * Сообщение отказа: строка или функция от деталей, прошедших схему.
   * Других аргументов у функции нет: все данные отказа лежат в `details`.
   * Без `message` сообщением становится код.
   */
  message?: string | ((details: StandardSchemaV1.InferOutput<S>) => string);

  /** Схема деталей: любая Standard Schema v1 */
  details: S;
}

/** Опции определения без деталей */
export interface FailSpecWithoutDetails {
  message?: string;
  details?: undefined;
}

/**
 * Проверяет, что значение создано `makeFail`.
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
 * `category`, `schema` и предикатом `is`. Вызов определения создаёт `Fail`.
 * Определение ничего не регистрирует; на приложение оно влияет только
 * через список `errors` декларации.
 *
 * Код — `category[:detail…]`. Категорию проверяет компилятор, формат
 * сегментов — эта функция. Отказ распознаётся по `code`, а не по
 * `instanceof`: отказ, полученный по сети, — обычный объект без прототипа.
 *
 * @example Отказ с деталями
 * ```typescript
 * export const OrderNotFound = makeFail('not_found:order', {
 *   details: z.object({ orderId: z.string() }),
 *   message: (d) => `Order ${d.orderId} not found`,
 * });
 *
 * return OrderNotFound({ orderId: '42' });
 * throw OrderNotFound({ orderId: '42' }, { cause: dbError });
 * ```
 *
 * @example Отказ без деталей
 * ```typescript
 * export const EmailTaken = makeFail('conflict:email_taken', {
 *   message: 'Email already taken',
 * });
 * export const Unauthorized = makeFail('unauthorized');
 *
 * return EmailTaken();
 * ```
 *
 * @throws {Error} При объявлении: сегмент кода вне `[a-z_]+` или
 * категория вне перечня. При конструировании: детали не прошли схему
 * (текст называет код отказа)
 */
export function makeFail<TCode extends FailCode, S extends StandardSchemaV1>(
  code: TCode,
  options: FailSpecWithDetails<S>,
): FailDefinitionWithDetails<TCode, StandardSchemaV1.InferOutput<S>>;
export function makeFail<TCode extends FailCode>(
  code: TCode,
  options?: FailSpecWithoutDetails,
): FailDefinitionWithoutDetails<TCode>;
export function makeFail(
  code: FailCode,
  options: {
    message?: string | ((details: unknown) => string);
    details?: StandardSchemaV1;
  } = {},
): AnyFailDefinition {
  assertFailCode(code, 'makeFail(…)');

  const { message = code, details: schema } = options;

  const definition = (
    first?: unknown,
    second?: FailCreateOptions,
  ): Fail<FailCode, unknown> => {
    // Со схемой первый аргумент — детали, без схемы — сразу опции.
    const details = schema
      ? validateSync(
          schema,
          first,
          `Fail '${code}': details do not match the declared schema`,
        )
      : undefined;
    const createOptions =
      (schema ? second : (first as FailCreateOptions)) ?? {};

    const text = typeof message === 'function' ? message(details) : message;

    return new Fail<FailCode, unknown>(code, text, {
      details,
      cause: createOptions.cause,
    });
  };

  const props = {
    code,
    category: categoryOf(code),
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
