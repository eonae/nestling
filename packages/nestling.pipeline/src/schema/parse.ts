import type { InputSources } from './types.js';

import type { DomainType, StandardSchemaV1 } from '@common/misc';
import { validateSync } from '@common/misc';

/**
 * Парсит и валидирует `payload` по схеме.
 *
 * Внутренняя функция для использования в транспортах. Для публичного
 * API используйте `input` декларации endpoint'а.
 *
 * @param schema - Схема, реализующая Standard Schema
 * @param sources - Источники входных данных
 * @returns Строго типизированный доменный объект
 * @throws {SchemaValidationError} Если валидация не прошла
 */
export function parsePayload<S extends StandardSchemaV1>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  return validateSync(schema, sources.payload, 'Payload validation failed');
}

/**
 * Парсит и валидирует `metadata` по схеме.
 *
 * Внутренняя функция для использования в транспортах. Для публичного
 * API используйте `metadata` декларации endpoint'а.
 *
 * @param schema - Схема, реализующая Standard Schema
 * @param sources - Источники входных данных
 * @returns Строго типизированный доменный объект
 * @throws {SchemaValidationError} Если валидация не прошла
 */
export function parseMetadata<S extends StandardSchemaV1>(
  schema: S,
  sources: InputSources,
): DomainType<S> {
  return validateSync(schema, sources.metadata, 'Metadata validation failed');
}
