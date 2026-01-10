import type { ResponseContext } from './context.js';

/**
 * Функция middleware
 * Преобразует контекст CIn → COut
 *
 * @param ctx - входной контекст
 * @param next - функция для вызова следующего middleware с преобразованным контекстом
 * @returns ResponseContext (может быть возвращён напрямую для short-circuit)
 */
export type MiddlewareFn<CIn = any, COut = any> = (
  ctx: CIn,
  next: (ctx: COut) => Promise<ResponseContext>,
) => Promise<ResponseContext>;

/**
 * Интерфейс для классовых middleware
 */
export interface IMiddleware<CIn = any, COut = any> {
  handle(
    ctx: CIn,
    next: (ctx: COut) => Promise<ResponseContext>,
  ): Promise<ResponseContext>;
}

/**
 * Middleware может быть функцией или классом
 */
export type Middleware<CIn = any, COut = any> =
  | MiddlewareFn<CIn, COut>
  | IMiddleware<CIn, COut>;

/**
 * Приводит middleware к функциональной форме
 */
export function normalizeMiddleware<CIn = any, COut = any>(
  mw: Middleware<CIn, COut>,
): MiddlewareFn<CIn, COut> {
  if (typeof mw === 'function') {
    return mw;
  }
  return mw.handle.bind(mw);
}

/**
 * Проверяет, является ли middleware классом
 */
export function isMiddlewareClass<CIn = any, COut = any>(
  mw: Middleware<CIn, COut>,
): mw is IMiddleware<CIn, COut> {
  return typeof mw !== 'function' && typeof mw.handle === 'function';
}
