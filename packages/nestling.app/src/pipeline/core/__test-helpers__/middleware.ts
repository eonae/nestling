import type { PreStepFn } from '../types/step.js';

import type { EmptyInput } from '@nestlingjs/operations';

/**
 * Добавляет timestamp в input
 * Используется в тестах для проверки накопления полей
 */
export const withTiming: PreStepFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
