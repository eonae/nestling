import type { PreUnitFn } from '../core/types/index.js';

/**
 * Интерфейс логгера
 */
export interface Logger {
  log(message: string): void;
}

/**
 * Логирует запросы
 *
 * Ничего не добавляет в input: использует только `raw.transport`
 * и `raw.pattern`, поэтому может стоять в любом месте среди pre-юнитов.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestLogging(console))
 *   .pre(withIdentity(verifyToken));
 * ```
 */
export function withRequestLogging(logger: Logger): PreUnitFn {
  return async (ctx) => {
    logger.log(`[${ctx.raw.transport}] ${ctx.raw.pattern} - started`);
  };
}
