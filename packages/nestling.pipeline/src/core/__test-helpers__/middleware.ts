import type { EmptyInput } from '../io/io.js';
import type { PreUnitFn } from '../types/unit.js';

/**
 * Добавляет timestamp в input
 * Используется в тестах для проверки накопления полей
 */
export const withTiming: PreUnitFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
