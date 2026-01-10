import type { AnyMeta } from '../core';
import type { MiddlewareFn, Raw, UnvalidatedContext } from '../core/types';

/**
 * Добавляет identity в metadata
 *
 * Читает raw.attributes для извлечения токена/сессии.
 * Работает только с UnvalidatedContext (до validate).
 *
 * @param authenticate - функция аутентификации, получает Raw и возвращает identity
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
 * // gRPC
 * const grpcAuth = withIdentity<User>(async (raw) => {
 *   const metadata = raw.attributes as GrpcMetadata;
 *   const token = metadata.get('authorization')[0];
 *   return await verifyJWT(token);
 * });
 *
 * const pipeline = definePipeline()
 *   .use(httpAuth)
 *   .use(validate());
 * ```
 */
export function withIdentity<TUser, M extends AnyMeta = AnyMeta>(
  authenticate: (raw: Raw) => Promise<TUser> | TUser,
): MiddlewareFn<
  UnvalidatedContext<M>,
  UnvalidatedContext<M & { identity: TUser }>
> {
  return async (ctx, next) => {
    const identity = await authenticate(ctx.raw);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        identity,
      } as M & { identity: TUser },
    });
  };
}
