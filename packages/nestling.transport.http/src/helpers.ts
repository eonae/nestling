import type { Constructor } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  EndpointDefinition,
  IEndpoint,
  Pipeline,
} from '@nestling/pipeline';
import { makeEndpoint, registerEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Опции для HttpEndpoint декоратора
 */
export interface HttpEndpointOptions<TInput, TMeta, TOutput> {
  /** Schema или модификатор для input */
  input?: AnyInput;

  /** Schema для output (опционально) */
  output?: AnyOutput;

  /** Pipeline для обработки запроса */
  pipeline: Pipeline<any, any>;

  /** Rate limit конфигурация */
  rateLimit?: unknown;

  /** Включить audit logging */
  audit?: boolean;

  /** Cache конфигурация */
  cache?: unknown;
}

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
 * @example
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
 */
export function HttpEndpoint<TInput, TMeta, TOutput>(
  method: HTTPMethod,
  path: string,
  options: HttpEndpointOptions<TInput, TMeta, TOutput>,
) {
  return <T extends Constructor<IEndpoint<TInput, TMeta, TOutput>>>(
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
      pipeline: options.pipeline,
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
