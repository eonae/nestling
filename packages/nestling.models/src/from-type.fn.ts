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

/**
 * Main helper
 */
export function fromType<T>() {
  return {
    defineModel: <S extends z.ZodTypeAny>(
      schema: S &
        (InputNarrows<S, T> extends false
          ? {
              ERROR: 'Schema input must be a valid narrowing of domain type';
              EXPECTED: T;
              RECEIVED: z.input<S>;
              EXTRA_KEYS: HasExtraKeys<z.input<S>, T>;
            }
          : unknown),
    ): S => {
      return schema;
    },
  };
}
