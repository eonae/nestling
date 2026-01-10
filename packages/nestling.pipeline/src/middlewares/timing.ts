import type { AnyContext } from '../core/types';

/**
 * Измеряет время выполнения запроса
 *
 * Добавляет заголовок X-Response-Time в ответ.
 * Работает с любым контекстом (до и после validate).
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withTiming)
 *   .use(withIdentity(verifyToken))
 *   .use(validate());
 * ```
 */
export function withTiming<C extends AnyContext>(
  ctx: C,
  next: (ctx: C) => Promise<any>,
): Promise<any> {
  return (async () => {
    const start = Date.now();
    const response = await next(ctx);
    const duration = Date.now() - start;

    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    return response;
  })();
}
