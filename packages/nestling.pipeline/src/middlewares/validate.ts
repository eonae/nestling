import type {
  MiddlewareFn,
  UnvalidatedContext,
  ValidatedContext,
} from '../core/types';

/**
 * Интерфейс для схемы валидации (zod-совместимый)
 */
interface ValidationSchema {
  parse(data: unknown): unknown;
}

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
export function validate<TMeta>(): MiddlewareFn<
  UnvalidatedContext<TMeta>,
  ValidatedContext<unknown, TMeta>
> {
  return async (ctx, next) => {
    // Получаем схему из endpoint metadata
    const schema = ctx.endpoint.input as ValidationSchema | undefined;

    const input: unknown = schema ? schema.parse(ctx.raw.payload) : {};

    // Создаём ValidatedContext с input
    // raw больше не передаётся — он недоступен после валидации
    return next({
      input,
      meta: ctx.meta,
      endpoint: ctx.endpoint,
    });
  };
}
