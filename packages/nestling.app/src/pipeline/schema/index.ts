export type * from './types.js';
export * from './parse.js';

/**
 * Диспетчер JSON Schema листа переехал в `@nestling/operations`, к
 * аннотации `jsonSchema`, которую он читает первым источником. Снимок
 * конфига строится до существования запроса, поэтому обращаться за
 * диспетчером в слой пайплайна конфиг не может.
 *
 * Реэкспорт сохраняется — для потребителя `@nestling/app` ничего
 * не меняется.
 */
export {
  assertConverters,
  leafJsonSchema,
  pickConverter,
  schemaVendorOf,
} from '@nestling/operations';
export type {
  LeafJsonSchema,
  SchemaDocConverter,
  SchemaDocOptions,
} from '@nestling/operations';

/**
 * Схемный кернел переехал в `@common/misc`: конфигурация читается и
 * валидируется до существования запроса, поэтому единственная точка
 * валидации не может жить в пакете request-пайплайна.
 *
 * Реэкспорт сохраняется — для потребителя `@nestling/app` ничего
 * не меняется.
 */
export {
  assertStandardSchema,
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
  validateSync,
} from '@common/misc';
export type { DomainType, SchemaIssue } from '@common/misc';
