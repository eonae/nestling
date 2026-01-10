import type { MiddlewareFn, UnvalidatedContext } from '../core/types';

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
  M extends { identity: unknown } = { identity: unknown },
>(
  getPermissions: (
    identity: M['identity'],
  ) => Promise<TPermissions> | TPermissions,
): MiddlewareFn<
  UnvalidatedContext<M>,
  UnvalidatedContext<M & { permissions: TPermissions }>
> {
  return async (ctx, next) => {
    const permissions = await getPermissions(ctx.meta.identity);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        permissions,
      } as M & { permissions: TPermissions },
    });
  };
}
