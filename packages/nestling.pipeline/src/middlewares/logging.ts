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
export function withLogging<TMeta>(
  logger: Logger,
): MiddlewareFn<UnvalidatedContext<TMeta>, UnvalidatedContext<TMeta>> {
  return async (ctx, next) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
    const response = await next(ctx);
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - completed`);
    return response;
  };
}
