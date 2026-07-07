import type { PreUnitFn } from '../core/types';

/**
 * Добавляет permissions в metadata
 *
 * Требует, чтобы identity уже была в input (типизированная зависимость
 * от предыдущего pre-юнита).
 *
 * @param getPermissions - функция загрузки permissions по identity
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withIdentity<User>(verifyToken))
 *   .pre(withPermissions<Permission[]>(async (identity) => {
 *     return await loadPermissions(identity.id);
 *   }))
 *   .pre(validate());
 * ```
 * */
export function withPermissions<TPermissions, TIdentity>(
  getPermissions: (identity: TIdentity) => Promise<TPermissions> | TPermissions,
): PreUnitFn<{ identity: TIdentity }, { permissions: TPermissions }> {
  return async (ctx) => {
    const permissions = await getPermissions(ctx.input.identity);

    return { permissions };
  };
}
