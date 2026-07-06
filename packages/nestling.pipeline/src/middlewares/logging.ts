import type { MiddlewareFn } from '../core/types';

/**
 * Интерфейс логгера
 */
export interface Logger {
  log(message: string): void;
}

/**
 * Логирует запросы
 *
 * Ничего не добавляет в input: использует только raw.transport
 * и raw.pattern, поэтому может стоять в любом месте цепочки.
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withRequestLogging(console))
 *   .use(withIdentity(verifyToken))
 *   .use(validate());
 * ```
 */
export function withRequestLogging(logger: Logger): MiddlewareFn {
  return async (ctx) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
  };
}
