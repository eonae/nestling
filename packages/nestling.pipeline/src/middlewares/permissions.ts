import type { MiddlewareFn } from '../core/types';

/**
 * Добавляет permissions в metadata
 *
 * Требует, чтобы identity уже была в meta.
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
 * */
export function withPermissions<TPermissions, TIdentity>(
  getPermissions: (identity: TIdentity) => Promise<TPermissions> | TPermissions,
): MiddlewareFn<{ identity: TIdentity }, { permissions: TPermissions }> {
  return async (ctx) => {
    const permissions = await getPermissions(ctx.input.identity);

    return { permissions };
  };
}
