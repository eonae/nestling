import type { AnyPayload, AnyInput } from '../core';
import type { AnyContext, MiddlewareFnAppending, NextContext, Raw } from '../core/types';

type WithIdentity<M extends AnyInput, TUser> = M & { identity: TUser };

/**
 * Добавляет identity в metadata
 *
 * Читает raw.attributes для извлечения токена/сессии.
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
export function withIdentity<
  TUser,
  I extends AnyPayload,
  M extends AnyInput,
  C extends AnyContext<I, M>,
>(
  authenticate: (raw: Raw) => Promise<TUser> | TUser,
): MiddlewareFnAppending<
  I,
  M,
  WithIdentity<M, TUser>,
  C,
  NextContext<C, I, M, WithIdentity<M, TUser>>
> {
  return async (ctx, next) => {
    const identity = await authenticate(ctx.raw);

    return next({
      ...ctx,
      meta: {
        ...ctx.meta,
        identity,
      },
    });
  };
}
