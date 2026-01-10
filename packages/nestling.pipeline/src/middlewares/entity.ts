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
export function withEntity<TKey extends string, TEntity, TInput, TMeta>(
  key: TKey,
  loadEntity: (input: TInput) => Promise<TEntity> | TEntity,
): MiddlewareFn<
  ValidatedContext<TInput, TMeta>,
  ValidatedContext<TInput, TMeta & Record<TKey, TEntity>>
> {
  return async (ctx, next) => {
    const entity = await loadEntity(ctx.input);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        [key]: entity,
      } as TMeta & Record<TKey, TEntity>,
    });
  };
}
