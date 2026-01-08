import type { IMiddleware } from '../core';

import type { Constructor } from '@common/misc';

/**
 * Глобальный registry для классов с декоратором @Middleware
 *
 * Используется App для автоматического обнаружения и регистрации middleware
 */
const middlewareRegistry = new Set<Constructor<IMiddleware>>();

/**
 * Регистрирует middleware-класс в глобальном registry
 *
 * @param ctor - Конструктор middleware-класса
 *
 * @example
 * ```typescript
 * @Injectable([ILogger('auth')])
 * @Middleware()
 * class AuthMiddleware {
 *   // ...
 * }
 * // Класс автоматически регистрируется декоратором @Middleware
 * ```
 */
export function registerMiddleware(ctor: Constructor<IMiddleware>): void {
  middlewareRegistry.add(ctor);
}

/**
 * Возвращает все зарегистрированные middleware-классы
 *
 * @returns Массив конструкторов всех middleware
 *
 * @example
 * ```typescript
 * const middlewares = getAllMiddleware();
 * for (const MiddlewareClass of middlewares) {
 *   const metadata = getMiddlewareMetadata(MiddlewareClass);
 *   console.log(`Found middleware: ${metadata.className}`);
 * }
 * ```
 */
export function getAllMiddleware(): Constructor<IMiddleware>[] {
  return [...middlewareRegistry];
}

/**
 * Очищает registry middleware (используется в тестах)
 *
 * @internal
 */
export function clearMiddlewareRegistry(): void {
  middlewareRegistry.clear();
}
