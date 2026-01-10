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
  TMeta = Record<string, never>,
>(
  key: TKey,
  getValue: (ctx: UnvalidatedContext<TMeta>) => Promise<TValue> | TValue,
): MiddlewareFn<
  UnvalidatedContext<TMeta>,
  UnvalidatedContext<TMeta & Record<TKey, TValue>>
> {
  return async (ctx, next) => {
    const value = await getValue(ctx);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: value,
      } as TMeta & Record<TKey, TValue>,
    });
  };
}
