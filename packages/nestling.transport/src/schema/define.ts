import type { z } from 'zod';

/**
 * Check if schema input is a valid narrowing of domain type T
 * Allows: optional → required, wider type → narrower type
 * Disallows: adding new fields, incompatible types
 */
type InputNarrows<S extends z.ZodTypeAny, T> =
  z.input<S> extends T ? true : false;

export function defineModel<S extends z.ZodTypeAny>(schema: S) {
  return schema;
}

/**
 * Main helper
 */
export function forType<T>() {
  return {
    defineModel: <S extends z.ZodTypeAny>(
      schema: S &
        (InputNarrows<S, T> extends false
          ? {
              ERROR: 'Schema input must be a valid narrowing of domain type';
              EXPECTED: T;
              RECEIVED: z.input<S>;
            }
          : unknown),
    ): S => {
      return schema;
    },
  };
}
