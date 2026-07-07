import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';

/**
 * Добавляет timestamp в input
 */
export const withTiming: PreUnitFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
