import type { AnyInput } from '../core';
import type { MiddlewareFnAppending, ExtendableContext } from '../core/types';

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
  M extends AnyInput = AnyInput,
>(
  key: TKey,
  getValue: (ctx: ExtendableContext<M>) => Promise<TValue> | TValue,
): MiddlewareFnAppending<
  ExtendableContext<M>,
  ExtendableContext<M & Record<TKey, TValue>>
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
