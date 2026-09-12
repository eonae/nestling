/**
 * `@nestlingjs/common.misc`: проверка значения схемой Standard Schema и
 * мелкие типы, общие для пакетов репозитория.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет. `StandardSchemaV1` приходит отдельным оператором из
 * пакета спецификации — ставить его потребителю не нужно.
 */

// ./errors.js — 5
export {
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
} from './errors.js';
export type { SchemaIssue } from './errors.js';

// ./types.js — 5
export type {
  Constructor,
  DomainType,
  Infer,
  Optional,
  Schema,
} from './types.js';
export type { StandardSchemaV1 } from '@standard-schema/spec';

// ./validate.js — 2
export { assertStandardSchema, validateSync } from './validate.js';
