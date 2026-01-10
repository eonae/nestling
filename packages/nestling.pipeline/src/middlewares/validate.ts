/* eslint-disable @typescript-eslint/consistent-type-definitions */
import type { EmptyInput } from '../core';
import type { MiddlewareFn } from '../core/types';

export type Addition = {
  payload: unknown | undefined;
};

/**
 * Валидирует raw.payload и создаёт input
 *
 * ❗ Это единственный способ получить input
 * ❗ После этого middleware raw недоступен
 *
 * Схема валидации берётся из endpoint.input.
 * TInput определяется endpoint'ом, не pipeline'ом.
 * Это позволяет переиспользовать один pipeline между endpoint'ами с разными input.
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline()
 *   .use(withIdentity(verifyToken))
 *   .use(validate());  // ← схема из endpoint.input
 *
 * // Один pipeline — разные endpoint'ы
 * @HttpEndpoint('POST', '/users', { pipeline, input: CreateUserSchema })
 * class CreateUser implements IEndpoint<CreateUserInput, { identity: User }, User> { ... }
 *
 * @HttpEndpoint('PUT', '/users/:id', { pipeline, input: UpdateUserSchema })
 * class UpdateUser implements IEndpoint<UpdateUserInput, { identity: User }, User> { ... }
 * ```
 */
export function validate(): MiddlewareFn<EmptyInput, Addition> {
  return async (ctx) => {
    const schema = ctx.endpoint.input;
    const payload = schema ? schema.parse(ctx.raw.payload) : undefined;

    return {
      payload,
    };
  };
}
