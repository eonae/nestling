import type { IMiddleware } from '../core';

import type { Constructor } from '@common/misc';

/* ============================================================
 * Middleware-классы
 * ============================================================ */

/**
 * Метаданные middleware-класса
 */
export interface MiddlewareMetadata {
  className: string;
}

/**
 * Symbol-ключ для хранения метаданных middleware-класса
 */
const MIDDLEWARE_KEY = Symbol.for('nestling:middleware');

/**
 * Декоратор для middleware-классов.
 *
 * @example
 * ```typescript
 * @Middleware()
 * class TimingMiddleware {
 *   async apply(ctx: RequestContext, next: () => Promise<ResponseContext>) {
 *     const start = Date.now();
 *     const response = await next();
 *     response.meta = {
 *       ...response.meta,
 *       timing: Date.now() - start,
 *     };
 *     return response;
 *   }
 * }
 * ```
 */
export function Middleware() {
  return <T extends Constructor<IMiddleware>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[MIDDLEWARE_KEY] = {
      className: context.name,
    };

    return target;
  };
}

/**
 * Извлекает метаданные middleware-класса
 */
export function getMiddlewareMetadata(target: any): MiddlewareMetadata | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[MIDDLEWARE_KEY] || null;
}
