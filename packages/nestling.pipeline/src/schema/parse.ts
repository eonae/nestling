import type { DomainType, InputSources } from './types.js';
import { validateSync } from './validate.js';

import type { StandardSchemaV1 } from '@common/misc';

/**
 * Парсит и валидирует payload согласно схеме
 *
 * Внутренняя функция для использования в транспортах.
 * Для публичного API используйте input в endpoint.
 *
 * @param schema - схема, реализующая Standard Schema v1
 * @param sources - Источники входных данных
 * @returns Строго типизированный domain объект
 * @throws SchemaValidationError если валидация не прошла
 */
export function parsePayload<S extends StandardSchemaV1>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  return validateSync(schema, sources.payload, 'Payload validation failed');
}

/**
 * Парсит и валидирует metadata согласно схеме
 *
 * Внутренняя функция для использования в транспортах.
 * Для публичного API используйте metadata в endpoint.
 *
 * @param schema - схема, реализующая Standard Schema v1
 * @param sources - Источники входных данных
 * @returns Строго типизированный metadata объект
 * @throws SchemaValidationError если валидация не прошла
 */
export function parseMetadata<S extends StandardSchemaV1>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  return validateSync(schema, sources.metadata, 'Metadata validation failed');
}
