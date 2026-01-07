/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import type { z } from 'zod';

/**
 * Check if a type is a plain object (not array, not primitive, not null, not function)
 */
type IsPlainObject<T> = T extends object
  ? T extends any[]
    ? false
    : T extends Function
      ? false
      : true
  : false;

/**
 * Remove undefined from type (for handling optional properties)
 */
type RemoveUndefined<T> = T extends undefined ? never : T;

/**
 * Get all extra keys from Input that are not in Target (top level)
 */
type ExtraKeysTopLevel<Input, Target> = Exclude<keyof Input, keyof Target>;

/**
 * For each key that exists in both Input and Target, check nested objects recursively
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
 * Recursively check for extra keys in Input compared to Target
 * Returns the union of all extra keys found (or never if none)
 */
type HasExtraKeys<Input, Target> = Input extends object
  ? Target extends object
    ? ExtraKeysTopLevel<Input, Target> | ExtraKeysNested<Input, Target>
    : keyof Input
  : never;

/**
 * Check if schema input is a valid narrowing of domain type T
 * Allows: optional → required, wider type → narrower type
 * Disallows: adding new fields (including nested), incompatible types
 */
type InputNarrows<S extends z.ZodTypeAny, T> =
  z.input<S> extends T
    ? HasExtraKeys<z.input<S>, T> extends never
      ? true
      : false
    : false;

// ============= FIELD-LEVEL VALIDATION TYPES =============

/**
 * Build full path to field (e.g., "address.street")
 */
type BuildPath<
  Parent extends string,
  Current extends string,
> = Parent extends '' ? Current : `${Parent}.${Current}`;

/**
 * Check if field schema is a valid narrowing of domain field type
 */
type IsFieldValid<FieldSchema, FieldDomain> = FieldSchema extends FieldDomain
  ? true
  : false;

/**
 * Get input type from Zod schema field
 */
type GetFieldInputType<FieldSchema extends z.ZodTypeAny> = z.input<FieldSchema>;

/**
 * Create constraint for invalid field type
 */

type FieldConstraint<
  K extends PropertyKey,
  FieldSchema extends z.ZodTypeAny,
  FieldDomain,
  Path extends string,
> =
  // K is used in Path construction via BuildPath in ValidateField
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
 * Create constraint for extra field (not in domain type)
 */

type ExtraFieldConstraint<
  K extends PropertyKey,
  FieldSchema extends z.ZodTypeAny,
  Path extends string,
> =
  // K is used in Path construction via BuildPath in ValidateObjectShape
  [K] extends [never]
    ? never
    : z.ZodTypeAny & {
        __EXTRA_FIELD__: Path;
        __FIELD_TYPE__: GetFieldInputType<FieldSchema>;
        __HINT__: 'This field is not in domain type. Remove it or add to domain type';
      };

/**
 * Validate nested z.object recursively
 * Returns constraint for the nested object's shape property
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
        ? // Recursively validate nested object shape
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
 * Validate single field with recursive nested object support
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
 * Validate object shape with field-level error reporting
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
 * Global constraint for non-object schemas (fallback)
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
 * Conditional constraint based on schema type
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
 * Main helper
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
