import type { AnyInput, AnyOutput, IEndpoint, Pipeline } from '../core';
import type {
  HandlerFn,
  UnvalidatedContext,
  ValidatedContext,
} from '../core/types';

import { registerEndpoint } from './endpoint-registry';

import type { Constructor } from '@common/misc';

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/**
 * Конфигурация endpoint-класса
 */
export interface EndpointDefinition<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Record<string, never> = Record<string, never>,
> {
  transport: string;
  pattern: string;

  handle: HandlerFn<I, M, O>;

  /** Schema или модификатор для input */
  input?: I;

  /** Конфигурация выходных данных */
  output?: O;

  /** Pipeline для этого endpoint */
  pipeline?: Pipeline<UnvalidatedContext<M>, ValidatedContext<I, M>>;
}

export type EndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Record<string, never> = Record<string, never>,
> = Omit<EndpointDefinition<I, O, M>, 'handle'>;

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
export function Endpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Record<string, never> = Record<string, never>,
>(metadata: EndpointMetadata<I, O, M>) {
  return <T extends Constructor<IEndpoint<I, O, M>>>(
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
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Record<string, never> = Record<string, never>,
>(target: any): EndpointMetadata<I, O, M> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Вспомогательная функция для создания конфигурации endpoint'а с корректным выводом типов.
 */
export function makeEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Record<string, never> = Record<string, never>,
>(definition: EndpointDefinition<I, O, M>): EndpointDefinition<I, O, M> {
  return definition;
}
