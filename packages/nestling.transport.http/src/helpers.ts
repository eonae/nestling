import type { Constructor } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  EndpointDefinition,
  FilesModifier,
  IEndpoint,
  Pipeline,
  StreamModifier,
  UnvalidatedContext,
  ValidatedContext,
  WithFilesModifier,
} from '@nestling/pipeline';
import { makeEndpoint, registerEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Опции для HttpEndpoint декоратора (с input схемой)
 *
 * ✅ Требует pipeline с validate()
 */
export interface HttpEndpointOptionsWithInput<TInput, TMeta, TOutput> {
  /** Schema или модификатор для input (обязательно) */
  input: AnyInput;

  /** Schema для output (опционально) */
  output?: AnyOutput;

  /** Pipeline для обработки запроса - ДОЛЖЕН содержать validate() */
  pipeline: Pipeline<
    UnvalidatedContext<Record<string, never>>,
    ValidatedContext<unknown, TMeta>
  >;

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
export interface HttpEndpointOptionsWithoutInput<TMeta, TOutput> {
  /** Schema или модификатор для input (не задан) */
  input?: never;

  /** Schema для output (опционально) */
  output?: AnyOutput;

  /** Pipeline для обработки запроса - может быть без validate() */
  pipeline: Pipeline<
    UnvalidatedContext<Record<string, never>>,
    UnvalidatedContext<TMeta>
  >;

  /** Rate limit конфигурация */
  rateLimit?: unknown;

  /** Включить audit logging */
  audit?: boolean;

  /** Cache конфигурация */
  cache?: unknown;
}

/**
 * Опции для HttpEndpoint декоратора (с модификаторами)
 *
 * ✅ Модификаторы (stream, withFiles, files) не требуют validate()
 * ✅ Валидация происходит на уровне транспорта
 */
export interface HttpEndpointOptionsWithModifier<_TInput, TMeta, _TOutput> {
  /** Модификатор для input (stream, withFiles, files) */
  input: StreamModifier<any> | WithFilesModifier<any> | FilesModifier;

  /** Schema для output (опционально) */
  output?: AnyOutput;

  /** Pipeline для обработки запроса - может быть без validate() */
  pipeline: Pipeline<
    UnvalidatedContext<Record<string, never>>,
    UnvalidatedContext<TMeta>
  >;

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
export type HttpEndpointOptions<TInput, TMeta, TOutput> =
  | HttpEndpointOptionsWithInput<TInput, TMeta, TOutput>
  | HttpEndpointOptionsWithoutInput<TMeta, TOutput>
  | HttpEndpointOptionsWithModifier<TInput, TMeta, TOutput>;

/**
 * Метаданные HTTP endpoint
 */
export interface HttpEndpointMetadata<TInput = unknown, TOutput = unknown> {
  transport: 'http';
  pattern: string;
  method: HTTPMethod;
  path: string;

  /** Schema для валидации input */
  input?: AnyInput;

  /** Schema для output (опционально) */
  output?: AnyOutput;

  /** Pipeline для этого endpoint */
  pipeline: Pipeline<any, any>;

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
export function HttpEndpoint<TInput, TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptionsWithInput<TInput, TMeta, TOutput>,
): <T extends Constructor<IEndpoint<TInput, TMeta, TOutput>>>(
  target: T,
  context: ClassDecoratorContext<T>,
) => T;

// Overload 2: с модификаторами (stream, withFiles) - validate() не нужен
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function HttpEndpoint<TInput, TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptionsWithModifier<TInput, TMeta, TOutput>,
): <T extends Constructor<IEndpoint<TInput, TMeta, TOutput>>>(
  target: T,
  context: ClassDecoratorContext<T>,
) => T;

// Overload 3: без input схемы - validate() не нужен
export function HttpEndpoint<TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptionsWithoutInput<TMeta, TOutput>,
): <T extends Constructor<IEndpoint<Record<string, never>, TMeta, TOutput>>>(
  target: T,
  context: ClassDecoratorContext<T>,
) => T;

// Реализация
export function HttpEndpoint<TInput, TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptions<TInput, TMeta, TOutput>,
) {
  return <T extends Constructor<IEndpoint<any, TMeta, TOutput>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    const metadata: HttpEndpointMetadata<TInput, TOutput> = {
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
export function makeHttpEndpoint<TInput, TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  meta: Omit<
    EndpointDefinition<TInput, TMeta, TOutput>,
    'transport' | 'pattern'
  >,
): EndpointDefinition<TInput, TMeta, TOutput> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}
