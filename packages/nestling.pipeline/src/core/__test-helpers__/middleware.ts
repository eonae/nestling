import type { EmptyInput } from '../io/io.js';
import type { MiddlewareFn } from '../types/middleware.before.js';

/**
 * Добавляет timestamp в input
 * Используется в тестах для проверки накопления полей
 */
export const withTiming: MiddlewareFn<
  EmptyInput,
  { timestamp: number }
> = async () => ({ timestamp: Date.now() });
