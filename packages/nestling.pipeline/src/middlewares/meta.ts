import type { AnyMeta } from '../core';
import type { MiddlewareFn, UnvalidatedContext } from '../core/types';

/**
 * Добавляет произвольное поле в metadata (до validate)
 *
 * Работает только с UnvalidatedContext.
 *
 * @param key - ключ поля в meta
 * @param getValue - функция получения значения
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withMeta('requestId', () => crypto.randomUUID()))
 *   .use(withMeta('timestamp', () => Date.now()))
 *   .use(validate());
 * ```
 */
export function withMeta<
  TKey extends string,
  TValue,
  M extends AnyMeta = AnyMeta,
>(
  key: TKey,
  getValue: (ctx: UnvalidatedContext<M>) => Promise<TValue> | TValue,
): MiddlewareFn<
  UnvalidatedContext<M>,
  UnvalidatedContext<M & Record<TKey, TValue>>
> {
  return async (ctx, next) => {
    const value = await getValue(ctx);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: value,
      } as M & Record<TKey, TValue>,
    });
  };
}
