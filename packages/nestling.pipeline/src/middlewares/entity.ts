import type { AnyInput, AnyMeta } from '../core';
import type { MiddlewareFn, ValidatedContext } from '../core/types';

/**
 * Добавляет поле в meta ПОСЛЕ валидации
 *
 * Работает только с ValidatedContext.
 * Используется для загрузки связанных сущностей по ID из input.
 *
 * @param key - ключ поля в meta
 * @param loadEntity - функция загрузки сущности по input
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withIdentity<User>(verifyToken))
 *   .use(validate())
 *   .use(withEntity('article', async (input) => {
 *     // input.id уже провалидирован!
 *     return await articleRepo.findById(input.id);
 *   }));
 * ```
 */
export function withEntity<
  TKey extends string,
  TEntity,
  I extends AnyInput = AnyInput,
  M extends AnyMeta = AnyMeta,
>(
  key: TKey,
  loadEntity: (input: I) => Promise<TEntity> | TEntity,
): MiddlewareFn<
  ValidatedContext<I, M>,
  ValidatedContext<I, M & Record<TKey, TEntity>>
> {
  return async (ctx, next) => {
    const entity = await loadEntity(ctx.input);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: entity,
      } as M & Record<TKey, TEntity>,
    });
  };
}
