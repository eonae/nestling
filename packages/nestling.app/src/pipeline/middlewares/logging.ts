import type { Logger } from '../../logger/interface.js';
import type { PreUnitFn } from '../core/types/index.js';

/**
 * Пишет запись о начале обработки запроса.
 *
 * Ничего не добавляет в input: использует только `raw.transport`
 * и `raw.pattern`, поэтому может стоять в любом месте среди pre-юнитов.
 * Запись уровня `info`: сообщение `request started`, поля `transport`
 * и `pattern`.
 *
 * @param logger - Логгер ядра; обычно член `Logger$(scope)`
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestLogging(logger))
 *   .pre(withIdentity(verifyToken));
 * ```
 */
export function withRequestLogging(logger: Logger): PreUnitFn {
  return async (ctx) => {
    logger.info('request started', {
      transport: ctx.raw.transport,
      pattern: ctx.raw.pattern,
    });
  };
}
