import type { EmptyInput } from '../core';
import type { PreUnitFn } from '../core/types';

import z from 'zod';

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
    const { success, data: requestId } = z
      .string()
      .safeParse(ctx.raw.attributes['x-request-id']);

    if (success) {
      return {
        requestId,
      };
    }
    return {
      requestId: crypto.randomUUID(),
    };
  };
}
