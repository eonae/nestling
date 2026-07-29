import type { EmptyInput } from '../core';
import type { PreUnitFn } from '../core/types';

/**
 * Добавляет requestId в metadata
 *
 * Извлекает requestId из headers или генерирует случайный
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestId())
 *   .pre(validate())
 * ```
 */
export function withRequestId(): PreUnitFn<EmptyInput, { requestId: string }> {
  return async (ctx) => {
    const requestId = ctx.raw.attributes['x-request-id'];

    if (typeof requestId === 'string') {
      return {
        requestId,
      };
    }
    return {
      requestId: crypto.randomUUID(),
    };
  };
}
