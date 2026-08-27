export type * from './types.js';
export * from './converter.js';
export * from './parse.js';

/**
 * Схемный кернел переехал в `@common/misc`: конфигурация читается и
 * валидируется до существования запроса, поэтому единственная точка
 * валидации не может жить в пакете request-пайплайна.
 *
 * Реэкспорт сохраняется — для потребителя `@nestling/pipeline` ничего
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
