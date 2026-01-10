import type { AnyInput } from '../io/io.js';

import type {
  AnyContext,
  AnyMeta,
  NextContext,
  ResponseContext,
} from './context.js';

/**
 * Функция middleware
 * Преобразует контекст CIn → COut
 *
 * @param ctx - входной контекст
 * @param next - функция для вызова следующего middleware с преобразованным контекстом
 * @returns ResponseContext (может быть возвращён напрямую для short-circuit)
 */
export type MiddlewareFn<
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
  CIn extends AnyContext<I, M>,
  COut extends NextContext<CIn, I, M, N>,
> = (
  ctx: CIn,
  next: (ctx: COut) => Promise<ResponseContext>,
) => Promise<ResponseContext>;

/**
 * Интерфейс для классовых middleware
 */
export interface IMiddleware<
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
  CIn extends AnyContext<I, M>,
  COut extends NextContext<CIn, I, M, N>,
> {
  handle: MiddlewareFn<I, M, N, CIn, COut>;
}

/**
 * Middleware может быть функцией или классом
 */
export type MiddlewareFnOrInstance<
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
  CIn extends AnyContext<I, M>,
  COut extends NextContext<CIn, I, M, N>,
> = MiddlewareFn<I, M, N, CIn, COut> | IMiddleware<I, M, N, CIn, COut>;

/**
 * Приводит middleware к функциональной форме
 */
export function normalizeMiddleware<
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
  CIn extends AnyContext<I, M>,
  COut extends NextContext<CIn, I, M, N>,
>(
  mw: MiddlewareFnOrInstance<I, M, N, CIn, COut>,
): MiddlewareFn<I, M, N, CIn, COut> {
  if (typeof mw === 'function') {
    return mw;
  }
  return mw.handle.bind(mw);
}

/**
 * Проверяет, является ли middleware классом
 */
export function isMiddlewareClass<
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
  CIn extends AnyContext<I, M>,
  COut extends NextContext<CIn, I, M, N>,
>(
  mw: MiddlewareFnOrInstance<I, M, N, CIn, COut>,
): mw is IMiddleware<I, M, N, CIn, COut> {
  return typeof mw !== 'function' && typeof mw.handle === 'function';
}
