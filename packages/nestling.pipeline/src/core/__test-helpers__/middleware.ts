import type { PreUnitFn } from '../types/unit.js';

import type { EmptyInput } from '@nestling/contracts';

/**
 * Добавляет timestamp в input
 * Используется в тестах для проверки накопления полей
 */
export const withTiming: PreUnitFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
