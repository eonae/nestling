import type { AnyInput, AnyMeta } from '../core';
import type { AnyContext, MiddlewareFn, NextContext } from '../core/types';

/**
 * Интерфейс логгера
 */
export interface Logger {
  log(message: string): void;
}

/**
 * Логирует запросы
 *
 * Работает только с UnvalidatedContext (до validate),
 * потому что использует raw.transport и raw.pattern.
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withLogging(console))
 *   .use(withIdentity(verifyToken))
 *   .use(validate());
 * ```
 */
export function withLogging<
  I extends AnyInput,
  M extends AnyMeta,
  C extends AnyContext<I, M>,
>(logger: Logger): MiddlewareFn<I, M, M, C, NextContext<C, I, M, M>> {
  return async (ctx, next) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
    const response = await next(ctx as NextContext<C, I, M, M>);
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - completed`);
    return response;
  };
}
