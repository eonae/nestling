import type { RequestContext, ResponseContext } from './context.js';

import type { Constructor } from '@common/misc';

/**
 * Интерфейс для middleware-классов
 * Используется для явной реализации контракта
 */
export interface IMiddleware {
  apply(
    ctx: RequestContext,
    next: () => Promise<ResponseContext>,
  ): Promise<ResponseContext>;
}

export type MiddlewareFn = IMiddleware['apply'];

export const isClass = (
  value: MiddlewareFn | Constructor<IMiddleware>,
): value is Constructor<IMiddleware> => {
  return typeof value?.prototype?.apply === 'function';
};
