import type { RequestContext } from '../core/interfaces.js';

import type { InputSources } from './types.js';

/**
 * Создаёт InputSources из RequestContext
 *
 * Извлекает payload и metadata из контекста
 *
 * @param ctx - Контекст запроса
 * @returns Объект InputSources с payload и metadata
 */
export function createInputSources(ctx: RequestContext): InputSources {
  // Payload уже объединён в транспорте
  const payload = (ctx.payload as Record<string, unknown>) || {};

  // Metadata уже содержит headers и meta
  const metadata = ctx.metadata || {};

  return {
    payload,
    metadata,
  };
}
