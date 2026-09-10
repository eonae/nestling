export type * from './types.js';
export * from './parse.js';

/**
 * Диспетчер JSON Schema листа переехал в `@nestlingjs/operations`, к
 * аннотации `jsonSchema`, которую он читает первым источником. Снимок
 * конфига строится до существования запроса, поэтому обращаться за
 * диспетчером в слой пайплайна конфиг не может.
 *
 * Реэкспорт сохраняется — для потребителя `@nestlingjs/app` ничего
 * не меняется.
 */
export {
  assertConverters,
  leafJsonSchema,
  pickConverter,
  schemaVendorOf,
} from '@nestlingjs/operations';
export type {
  LeafJsonSchema,
  SchemaDocConverter,
  SchemaDocOptions,
} from '@nestlingjs/operations';

/**
 * Схемный кернел переехал в `@nestlingjs/common.misc`: конфигурация читается и
 * валидируется до существования запроса, поэтому единственная точка
 * валидации не может жить в пакете request-пайплайна.
 *
 * Реэкспорт сохраняется — для потребителя `@nestlingjs/app` ничего
 * не меняется.
 */
export {
  assertStandardSchema,
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
  validateSync,
} from '@nestlingjs/common.misc';
export type { DomainType, SchemaIssue } from '@nestlingjs/common.misc';
