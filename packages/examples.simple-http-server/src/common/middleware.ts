import type { EmptyInput, MiddlewareFn } from '@nestling/pipeline';

/**
 * Добавляет timestamp в input
 */
export const withTiming: MiddlewareFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
