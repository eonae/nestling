import type { z } from 'zod';

export type Constructor<T> = new (...args: any[]) => T;

/**
 * Выводит тип из Zod схемы или возвращает undefined если схема не передана
 */
export type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;

export type MaybeSchema = z.ZodTypeAny | undefined;
