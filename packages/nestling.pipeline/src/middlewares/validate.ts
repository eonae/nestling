import type { EmptyInput } from '../core';
import type { MiddlewareFn } from '../core/types';

/**
 * Валидирует raw.payload и создаёт payload
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(validate());
 * ```
 */
export function validate(): MiddlewareFn<
  EmptyInput,
  { payload: unknown | undefined }
> {
  return async (ctx) => {
    const schema = ctx.endpoint.input;

    if (!schema) {
      return;
    }

    const payload = schema.parse(ctx.raw.payload);

    return {
      payload,
    };
  };
}
