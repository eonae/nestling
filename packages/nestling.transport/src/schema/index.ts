// Types
export type { DomainType, InputSources } from './types.js';

// Schema definition
export { defineModel as define, forType } from './define.js';

// Parsers
export { parseMetadata, parsePayload, SchemaValidationError } from './parse.js';

// Merge utilities
export { mergePayload } from './merge.js';

// Helpers
export {
  createInputSources,
  extractDescription,
  validateOrThrow,
} from './helpers.js';
