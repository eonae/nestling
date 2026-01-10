import type { AnyInput } from '../core';
import type { ExtendableContext, MiddlewareFn } from '../core/types';

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
export function withRequestLogging<
  I extends AnyInput,
  CNext extends ExtendableContext<I>,
>(logger: Logger): MiddlewareFn<I, undefined, CNext> {
  return async (ctx) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
  };
}
