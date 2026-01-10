import type { Constructor } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  EmptyMeta,
  EndpointDefinition,
  IEndpoint,
  Pipeline,
  UnvalidatedContext,
  ValidatedContext,
} from '@nestling/pipeline';
import { makeEndpoint, registerEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Опции для HttpEndpoint декоратора (с input схемой)
 *
 * ✅ Требует pipeline с validate()
 */
export interface HttpEndpointOptionsWithInput<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
> {
  /** Schema или модификатор для input (обязательно) */
  input: I;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для обработки запроса - ДОЛЖЕН содержать validate() */
  pipeline: Pipeline<UnvalidatedContext<M>, ValidatedContext<I, M>>;

  /** Rate limit конфигурация */
  rateLimit?: unknown;

  /** Включить audit logging */
  audit?: boolean;

  /** Cache конфигурация */
  cache?: unknown;
}

/**
 * Опции для HttpEndpoint декоратора (без input схемы)
 *
 * ✅ Допускает pipeline без validate()
 */
export interface HttpEndpointOptionsWithoutInput<
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
> {
  /** Schema или модификатор для input (не задан) */
  input?: never;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для обработки запроса - может быть без validate() */
  pipeline: Pipeline<UnvalidatedContext<M>, UnvalidatedContext<M>>;

  /** Rate limit конфигурация */
  rateLimit?: unknown;

  /** Включить audit logging */
  audit?: boolean;

  /** Cache конфигурация */
  cache?: unknown;
}

/**
 * Unified опции (для совместимости)
 */
export type HttpEndpointOptions<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
> =
  | HttpEndpointOptionsWithInput<I, O, M>
  | HttpEndpointOptionsWithoutInput<O, M>;

/**
 * Метаданные HTTP endpoint
 */
export interface HttpEndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
> {
  transport: 'http';
  pattern: string;
  method: HTTPMethod;
  path: string;

  /** Schema для валидации input */
  input?: I;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для этого endpoint */
  pipeline: Pipeline<UnvalidatedContext<M>, ValidatedContext<I, M>>;

  /** Дополнительные опции для middleware */
  rateLimit?: unknown;
  audit?: boolean;
  cache?: unknown;

  /** Имя класса (для отладки) */
  className?: string;

  [key: string]: unknown;
}

/**
 * HttpEndpoint с pipeline
 *
 * Pipeline - часть metadata endpoint'а (не отдельный декоратор!)
 *
 * @example С input схемой (требует validate())
 * ```typescript
 * const authPipeline = definePipeline()
 *   .use(withIdentity<User>(verifyToken))
 *   .use(validate());
 *
 * @Injectable([UserService])
 * @HttpEndpoint('POST', '/api/users', {
 *   input: CreateUserSchema,
 *   pipeline: authPipeline,
 * })
 * export class CreateUserEndpoint implements IEndpoint<
 *   CreateUserInput,
 *   { identity: User },
 *   CreateUserOutput
 * > {
 *   constructor(private users: UserService) {}
 *
 *   async handle(input: CreateUserInput, meta: { identity: User }) {
 *     const user = await this.users.create(input);
 *     return Ok.created(user);
 *   }
 * }
 * ```
 *
 * @example Без input схемы (validate() не нужен)
 * ```typescript
 * const simplePipeline = definePipeline().use(withTiming());
 *
 * @Injectable([])
 * @HttpEndpoint('GET', '/health', {
 *   pipeline: simplePipeline,
 * })
 * export class HealthCheck implements IEndpoint<{}, {}, { status: string }> {
 *   async handle() {
 *     return Ok({ status: 'ok' });
 *   }
 * }
 * ```
 */

// Overload 1: с input схемой - требует validate()
export function HttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptionsWithInput<I, O, M>,
): <T extends Constructor<IEndpoint<I, O, M>>>(
  target: T,
  context: ClassDecoratorContext<T>,
) => T;

// Overload 3: без input схемы - validate() не нужен
export function HttpEndpoint<
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptionsWithoutInput<O, M>,
): <T extends Constructor<IEndpoint<any, O, M>>>(
  target: T,
  context: ClassDecoratorContext<T>,
) => T;

// Реализация
export function HttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
>(method: HTTPMethod, path: string, options: HttpEndpointOptions<I, O, M>) {
  return <T extends Constructor<IEndpoint<I, O, M>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    const metadata: HttpEndpointMetadata<I, O, M> = {
      transport: 'http',
      pattern: `${method} ${path}`,
      method,
      path,
      input: options.input,
      output: options.output,
      pipeline: options.pipeline as any,
      rateLimit: options.rateLimit,
      audit: options.audit,
      cache: options.cache,
      className: context.name,
    };

    const HANDLER_KEY = Symbol.for('nestling:handler');
    (target as any)[HANDLER_KEY] = metadata;

    registerEndpoint(target as Constructor<any>);

    return target;
  };
}

/**
 * Извлекает метаданные HTTP endpoint класса
 */
export function getHttpEndpointMetadata(
  target: any,
): HttpEndpointMetadata | null {
  const HANDLER_KEY = Symbol.for('nestling:handler');
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Создаёт endpoint definition для HTTP
 */
export function makeHttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends EmptyMeta = EmptyMeta,
>(
  method: HTTPMethod,
  path: string,
  meta: Omit<EndpointDefinition<I, O, M>, 'transport' | 'pattern'>,
): EndpointDefinition<I, O, M> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}
