/**
 * Модель без доменного типа: схема и есть объявление.
 *
 * Обе функции возвращают схему как есть. Они нужны там, где доменного типа
 * ещё нет: тип выводится из схемы, а `fromType` сверяет схему с уже
 * существующим типом.
 */

import type { z } from 'zod';

/**
 * Пара `fromType<T>()` для случая, когда доменного типа нет.
 *
 * @returns Значение с `makeModel`, возвращающим схему как есть
 *
 * @example
 * ```typescript
 * const CreateUser = fromScratch().makeModel(
 *   z.object({ email: z.email() }),
 * );
 * ```
 */
export function fromScratch(): {
  makeModel: <S extends z.ZodTypeAny>(schema: S) => S;
} {
  return {
    makeModel: <S extends z.ZodTypeAny>(schema: S): S => {
      return schema;
    },
  };
}

/**
 * То же, что `fromScratch().makeModel(schema)`, одним вызовом.
 *
 * @param schema - Схема модели
 * @returns Та же схема
 */
export function makeModel<S extends z.ZodTypeAny>(schema: S): S {
  return schema;
}
