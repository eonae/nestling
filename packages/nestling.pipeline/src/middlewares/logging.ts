import type { AnyMeta } from '../core';
import type { MiddlewareFn, UnvalidatedContext } from '../core/types';

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
export function withLogging<M extends AnyMeta = AnyMeta>(
  logger: Logger,
): MiddlewareFn<UnvalidatedContext<M>, UnvalidatedContext<M>> {
  return async (ctx, next) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
    const response = await next(ctx);
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - completed`);
    return response;
  };
}
