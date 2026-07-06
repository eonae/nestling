import type { IMiddleware } from '../core';

import { registerMiddleware } from './middleware-registry';

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
 * class AuthMiddleware implements IMiddleware<EmptyInput, { identity: User }> {
 *   async handle(ctx: ExtendableContext<EmptyInput>) {
 *     const identity = await verifyToken(ctx.raw.attributes);
 *     return { identity };
 *   }
 * }
 * ```
 */
export function MiddlewareDecorator() {
  return <T extends Constructor<IMiddleware<any, any>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[MIDDLEWARE_KEY] = {
      className: context.name,
    };

    // Автоматически регистрируем middleware в глобальном registry
    registerMiddleware(target);

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
