import type { z } from 'zod';

export type Constructor<T> = new (...args: any[]) => T;
export type Optional<T> = T | undefined;
export type Nullable<T> = T | null;
export type Nullish<T> = Nullable<T> | undefined;

export type Schema = z.ZodTypeAny;

/**
 * Выводит тип из Zod схемы или возвращает undefined если схема не передана
 */
export type Infer<T extends Optional<Schema>> = T extends z.ZodTypeAny
  ? z.infer<T>
  : undefined;
