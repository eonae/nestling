import type { MiddlewareFn } from '../core/types';

/**
 * Измеряет время выполнения запроса
 *
 * Добавляет заголовок X-Response-Time в ответ.
 * Работает с любым контекстом (до и после validate).
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withTiming())
 *   .use(withIdentity(verifyToken))
 *   .use(validate());
 * ```
 */
export function withTiming<C>(): MiddlewareFn<C, C> {
  return async (ctx, next) => {
    const start = Date.now();
    const response = await next(ctx);
    const duration = Date.now() - start;

    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    return response;
  };
}
