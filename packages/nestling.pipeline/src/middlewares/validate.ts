import type { EmptyInput } from '../core';
import { analyzePayload, Fail } from '../core';
import type { PreUnitFn } from '../core/types';
import { SchemaValidationError, validateSync } from '../schema';

import type { Schema } from '@common/misc';

/**
 * Валидирует raw.payload и создаёт payload
 *
 * Работает только с schema-input: stream/files/withFiles/primitive
 * подготавливаются транспортом, их payload передаётся handler'у как есть.
 *
 * При ошибке валидации бросает Fail.badRequest (HTTP 400).
 *
 * Ошибки конфигурации приложения — async-схема
 * (`AsyncSchemaNotSupportedError`) и объект-не-схема
 * (`NotAStandardSchemaError`) — пробрасываются наружу как есть: это не
 * ошибка входа, и 400 их бы замаскировал.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(validate());
 * ```
 */
export function validate(): PreUnitFn<
  EmptyInput,
  { payload: unknown | undefined }
> {
  return async (ctx) => {
    const config = analyzePayload(ctx.endpoint.input);

    if (config.type !== 'schema' || !config.schema) {
      return;
    }

    try {
      const payload = validateSync(
        config.schema as Schema,
        ctx.raw.payload,
        'Validation failed',
      );

      return {
        payload,
      };
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw Fail.badRequest(error.message, error.issues);
      }

      throw error;
    }
  };
}
