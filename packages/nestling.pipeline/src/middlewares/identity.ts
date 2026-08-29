import type { EmptyInput } from '../core';
import type { PreUnitFn, Raw } from '../core/types';

/**
 * Добавляет `identity` в контекст запроса.
 *
 * Читает `raw.attributes`, чтобы извлечь токен или сессию.
 *
 * @param authenticate - Функция аутентификации: получает `Raw` и
 * возвращает identity
 *
 * @example
 * ```typescript
 * // HTTP с JWT
 * const httpAuth = withIdentity<User>(async (raw) => {
 *   const headers = raw.attributes as Record<string, string>;
 *   const token = headers['authorization'];
 *   return await verifyJWT(token);
 * });
 *
 * const pipeline = makePipeline()
 *   .pre(httpAuth)
 *   .pre(validate());
 * ```
 */
export function withIdentity<TUser>(
  authenticate: (raw: Raw) => Promise<TUser> | TUser,
): PreUnitFn<EmptyInput, { identity: TUser }> {
  return async (ctx) => {
    const identity = await authenticate(ctx.raw);

    return { identity };
  };
}
