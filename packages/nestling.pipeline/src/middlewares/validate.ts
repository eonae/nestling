import type { EmptyInput } from '../core';
import { analyzePayload, Fail } from '../core';
import type { PreUnitFn } from '../core/types';

/**
 * Валидирует raw.payload и создаёт payload
 *
 * Работает только с schema-input: stream/files/withFiles/primitive
 * подготавливаются транспортом, их payload передаётся handler'у как есть.
 *
 * При ошибке валидации бросает Fail.badRequest (HTTP 400).
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

    const schema = config.schema as { parse(data: unknown): unknown };

    try {
      const payload = schema.parse(ctx.raw.payload);

      return {
        payload,
      };
    } catch (error) {
      const issues =
        error && typeof error === 'object' && 'issues' in error
          ? (error as { issues: unknown }).issues
          : undefined;

      throw Fail.badRequest('Validation failed', issues);
    }
  };
}
