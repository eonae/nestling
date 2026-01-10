import type { AnyInput } from '../core';
import type { AnyContext, AnyMeta, MiddlewareFn } from '../core/types';

type WithPermissions<M extends AnyMeta, TPermissions> = M & {
  permissions: TPermissions;
};

/**
 * Добавляет permissions в metadata
 *
 * Требует, чтобы identity уже была в meta.
 * Работает только с UnvalidatedContext (до validate).
 *
 * @param getPermissions - функция загрузки permissions по identity
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withIdentity<User>(verifyToken))
 *   .use(withPermissions<Permission[]>(async (identity) => {
 *     return await loadPermissions(identity.id);
 *   }))
 *   .use(validate());
 * ```
 */
export function withPermissions<
  TPermissions,
  I extends AnyInput,
  U,
  M extends { identity: U },
>(
  getPermissions: (
    identity: M['identity'],
  ) => Promise<TPermissions> | TPermissions,
): MiddlewareFn<
  I,
  M,
  WithPermissions<M, TPermissions>,
  AnyContext<I, M>,
  AnyContext<I, WithPermissions<M, TPermissions>>
> {
  return async (ctx, next) => {
    const permissions = await getPermissions(ctx.meta.identity);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        permissions,
      },
    });
  };
}
