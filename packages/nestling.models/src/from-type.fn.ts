/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type { z } from 'zod';

/**
 * Проверяет, является ли T обычным объектом: не массив, не примитив,
 * не null и не функция.
 */
type IsPlainObject<T> = T extends object
  ? T extends any[]
    ? false
    : T extends Function
      ? false
      : true
  : false;

/**
 * Убирает `undefined` из типа — нужно для необязательных полей.
 */
type RemoveUndefined<T> = T extends undefined ? never : T;

/**
 * Ключи Input, которых нет в Target, на верхнем уровне.
 */
type ExtraKeysTopLevel<Input, Target> = Exclude<keyof Input, keyof Target>;

/**
 * Для каждого ключа, общего для Input и Target, рекурсивно проверяет
 * вложенные объекты.
 */
type ExtraKeysNested<Input, Target> = {
  [K in keyof Input & keyof Target]: IsPlainObject<Input[K]> extends true
    ? IsPlainObject<RemoveUndefined<Target[K]>> extends true
      ? // Both are objects, recurse (removing undefined from Target for optional props)
        HasExtraKeys<Input[K], RemoveUndefined<Target[K]>>
      : never
    : never;
}[keyof Input & keyof Target];

/**
 * Рекурсивно ищет в Input ключи, которых нет в Target.
 *
 * Возвращает объединение всех найденных лишних ключей или `never`, если
 * их нет.
 */
type HasExtraKeys<Input, Target> = Input extends object
  ? Target extends object
    ? ExtraKeysTopLevel<Input, Target> | ExtraKeysNested<Input, Target>
    : keyof Input
  : never;

/**
 * Проверяет, что вход схемы — допустимое сужение доменного типа T.
 *
 * Разрешено делать необязательное поле обязательным и сужать тип поля.
 * Не разрешено добавлять новые поля, в том числе вложенные, и заменять
 * тип на несовместимый.
 */
type InputNarrows<S extends z.ZodTypeAny, T> =
  z.input<S> extends T
    ? HasExtraKeys<z.input<S>, T> extends never
      ? true
      : false
    : false;

// ============= ВАЛИДАЦИЯ НА УРОВНЕ ПОЛЕЙ =============

/**
 * Строит полный путь до поля, например `address.street`.
 */
type BuildPath<
  Parent extends string,
  Current extends string,
> = Parent extends '' ? Current : `${Parent}.${Current}`;

/**
 * Проверяет, что схема поля — допустимое сужение доменного типа поля.
 */
type IsFieldValid<FieldSchema, FieldDomain> = FieldSchema extends FieldDomain
  ? true
  : false;

/**
 * Тип входа схемы поля zod.
 */
type GetFieldInputType<FieldSchema extends z.ZodTypeAny> = z.input<FieldSchema>;

/**
 * Ограничение типа для поля с недопустимым типом.
 */

type FieldConstraint<
  K extends PropertyKey,
  FieldSchema extends z.ZodTypeAny,
  FieldDomain,
  Path extends string,
> =
  // K участвует в построении Path через BuildPath в ValidateField
  [K] extends [never]
    ? never
    : IsFieldValid<GetFieldInputType<FieldSchema>, FieldDomain> extends true
      ? z.ZodTypeAny
      : z.ZodTypeAny & {
          __FIELD_ERROR__: Path;
          __EXPECTED__: FieldDomain;
          __RECEIVED__: GetFieldInputType<FieldSchema>;
          __HINT__: 'Cannot widen types (required→optional ❌). Only narrowing allowed (optional→required ✅)';
        };

/**
 * Ограничение типа для поля, которого нет в доменном типе.
 */

type ExtraFieldConstraint<
  K extends PropertyKey,
  FieldSchema extends z.ZodTypeAny,
  Path extends string,
> =
  // K участвует в построении Path через BuildPath в ValidateObjectShape
  [K] extends [never]
    ? never
    : z.ZodTypeAny & {
        __EXTRA_FIELD__: Path;
        __FIELD_TYPE__: GetFieldInputType<FieldSchema>;
        __HINT__: 'This field is not in domain type. Remove it or add to domain type';
      };

/**
 * Рекурсивно проверяет вложенный `z.object`.
 *
 * Возвращает ограничение для поля `shape` вложенного объекта.
 */
type ValidateNestedObject<
  FieldSchema extends z.ZodTypeAny,
  FieldDomain,
  Path extends string,
  DomainType,
> =
  FieldSchema extends z.ZodObject<infer NestedShape>
    ? NestedShape extends z.ZodRawShape
      ? FieldDomain extends object
        ? // Рекурсивно проверяет форму вложенного объекта
          {
            shape: ValidateObjectShape<
              NestedShape,
              RemoveUndefined<FieldDomain>,
              Path,
              DomainType
            >;
          }
        : {
            shape: z.ZodRawShape & {
              __FIELD_ERROR__: Path;
              __EXPECTED__: 'object';
              __RECEIVED__: GetFieldInputType<FieldSchema>;
              __HINT__: 'Nested object schema but domain field is not an object';
            };
          }
      : never
    : never;

/**
 * Проверяет одно поле, включая рекурсивную проверку вложенных объектов.
 */
type ValidateField<
  K extends PropertyKey,
  FieldSchema extends z.ZodTypeAny,
  FieldDomain,
  Path extends string,
  DomainType,
> =
  ValidateNestedObject<FieldSchema, FieldDomain, Path, DomainType> extends never
    ? FieldConstraint<K, FieldSchema, FieldDomain, Path>
    : FieldSchema extends z.ZodObject<infer NestedShape>
      ? NestedShape extends z.ZodRawShape
        ? z.ZodObject<NestedShape> &
            ValidateNestedObject<FieldSchema, FieldDomain, Path, DomainType>
        : FieldConstraint<K, FieldSchema, FieldDomain, Path>
      : FieldConstraint<K, FieldSchema, FieldDomain, Path>;

/**
 * Проверяет форму объекта (`shape`) с сообщением об ошибке для каждого поля.
 */
type ValidateObjectShape<
  Shape extends z.ZodRawShape,
  DomainType,
  ParentPath extends string = '',
  FullDomainType = DomainType,
> = {
  [K in keyof Shape]: Shape[K] extends z.ZodTypeAny
    ? K extends keyof DomainType
      ? ValidateField<
          K,
          Shape[K],
          DomainType[K],
          BuildPath<ParentPath, K & string>,
          FullDomainType
        >
      : ExtraFieldConstraint<K, Shape[K], BuildPath<ParentPath, K & string>>
    : z.ZodTypeAny;
};

/**
 * Ограничение для схем, которые не описывают объект (запасной вариант).
 */
type GlobalConstraint<S extends z.ZodTypeAny, T> =
  InputNarrows<S, T> extends false
    ? {
        ERROR: 'Schema input must be a valid narrowing of domain type';
        EXPECTED: T;
        RECEIVED: z.input<S>;
        EXTRA_KEYS: HasExtraKeys<z.input<S>, T>;
      }
    : unknown;

/**
 * Выбирает ограничение в зависимости от вида схемы.
 */
type SchemaConstraint<S extends z.ZodTypeAny, T> =
  S extends z.ZodObject<infer Shape>
    ? Shape extends z.ZodRawShape
      ? {
          shape: ValidateObjectShape<Shape, T>;
        }
      : GlobalConstraint<S, T>
    : GlobalConstraint<S, T>;

/**
 * Создаёт `makeModel`, который проверяет вход схемы как сужение
 * доменного типа `T` на уровне типов.
 */
export function fromType<T>() {
  return {
    makeModel: <S extends z.ZodTypeAny>(
      schema: S & SchemaConstraint<S, T>,
    ): S => {
      return schema as S;
    },
  };
}
