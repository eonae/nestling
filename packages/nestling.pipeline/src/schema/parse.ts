import type { DomainType, InputSources } from './types.js';

import type { z, ZodError } from 'zod';

/**
 * Ошибка валидации схемы
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: ZodError,
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * Парсит и валидирует payload согласно схеме
 *
 * Внутренняя функция для использования в транспортах.
 * Для публичного API используйте input в endpoint.
 *
 * @param schema - Zod схема для валидации
 * @param sources - Источники входных данных
 * @returns Строго типизированный domain объект
 * @throws SchemaValidationError если валидация не прошла
 */
export function parsePayload<S extends z.ZodType<any, any, any>>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  try {
    return schema.parse(sources.payload) as DomainType<S>;
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      throw new SchemaValidationError(
        'Payload validation failed',
        error as ZodError,
      );
    }
    throw error;
  }
}

/**
 * Парсит и валидирует metadata согласно схеме
 *
 * Внутренняя функция для использования в транспортах.
 * Для публичного API используйте metadata в endpoint.
 *
 * @param schema - Zod схема для валидации metadata
 * @param sources - Источники входных данных
 * @returns Строго типизированный metadata объект
 * @throws SchemaValidationError если валидация не прошла
 */
export function parseMetadata<S extends z.ZodType<any, any, any>>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  try {
    return schema.parse(sources.metadata) as DomainType<S>;
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      throw new SchemaValidationError(
        'Metadata validation failed',
        error as ZodError,
      );
    }
    throw error;
  }
}
