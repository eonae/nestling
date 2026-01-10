import type { AnyInput, AnyOutput, IEndpoint, Pipeline } from '../core';
import type { HandlerFn } from '../core/types';

import { registerEndpoint } from './endpoint-registry';

import type { Constructor } from '@common/misc';

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/**
 * Конфигурация endpoint-класса
 */
export interface EndpointDefinition<TInput = any, TMeta = any, TOutput = any> {
  transport: string;
  pattern: string;

  handle: HandlerFn<TInput, TMeta, TOutput>;

  /** Schema или модификатор для input */
  input?: AnyInput;

  /** Конфигурация выходных данных */
  output?: AnyOutput;

  /** Pipeline для этого endpoint */
  pipeline?: Pipeline<any, any>;
}

export type EndpointMetadata<
  TInput = unknown,
  TMeta = unknown,
  TOutput = unknown,
> = Omit<EndpointDefinition<TInput, TMeta, TOutput>, 'handle'>;

/**
 * Декоратор для endpoint-классов с типизированным pipeline.
 *
 * @example
 * ```typescript
 * const authPipeline = definePipeline()
 *   .use(withIdentity<User>(verifyToken))
 *   .use(validate());
 *
 * @Injectable([UserService])
 * @Endpoint({
 *   transport: 'http',
 *   pattern: 'POST /users',
 *   input: CreateUserSchema,
 *   pipeline: authPipeline,
 * })
 * class CreateUserEndpoint implements IEndpoint<CreateUserInput, { identity: User }, User> {
 *   constructor(private users: UserService) {}
 *
 *   async handle(input: CreateUserInput, meta: { identity: User }) {
 *     return Ok.created(await this.users.create(input));
 *   }
 * }
 * ```
 */
export function Endpoint<TInput = any, TMeta = any, TOutput = any>(
  metadata: EndpointMetadata<TInput, TMeta, TOutput>,
) {
  return <T extends Constructor<IEndpoint<TInput, TMeta, TOutput>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[HANDLER_KEY] = {
      ...metadata,
      className: context.name,
    };

    // Автоматически регистрируем endpoint в глобальном registry
    registerEndpoint(target as Constructor<IEndpoint<any, any, any>>);

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getEndpointMetadata<
  TInput = unknown,
  TMeta = unknown,
  TOutput = unknown,
>(target: any): EndpointMetadata<TInput, TMeta, TOutput> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Вспомогательная функция для создания конфигурации endpoint'а с корректным выводом типов.
 */
export function makeEndpoint<TInput = any, TMeta = any, TOutput = any>(
  definition: EndpointDefinition<TInput, TMeta, TOutput>,
): EndpointDefinition<TInput, TMeta, TOutput> {
  return definition;
}
