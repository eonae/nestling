import type { StandardSchemaV1 } from '@standard-schema/spec';

export type { StandardSchemaV1 } from '@standard-schema/spec';

export type Constructor<T> = new (...args: any[]) => T;
export type Optional<T> = T | undefined;
export type Nullable<T> = T | null;
export type Nullish<T> = Nullable<T> | undefined;

/**
 * Схема валидации — любая реализация Standard Schema v1
 * (zod ≥ 3.24, valibot ≥ 1.0, arktype, TypeBox, Effect Schema …).
 *
 * Ядро не интроспектирует схему: спека даёт только `validate` и фантомные
 * типы для инференса.
 */
export type Schema = StandardSchemaV1;

/**
 * Выводит выходной тип схемы или возвращает undefined, если схема не передана
 */
export type Infer<T extends Optional<Schema>> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : undefined;

/**
 * Выводит domain-тип из схемы — выход `~standard.types.output`
 */
export type DomainType<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
