import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  IEndpoint,
  Pipeline,
} from '../core';
import type { HandlerFn } from '../core/types';

import { registerEndpoint } from './endpoint-registry';

import type { Constructor } from '@common/misc';

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/**
 * Конфигурация endpoint-класса
 *
 * @param I - схема input
 * @param O - схема output
 * @param TInput - выходной тип pipeline (добавляемые middleware поля)
 */
export interface EndpointDefinition<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
> {
  transport: string;
  pattern: string;

  handle: HandlerFn<I, O, P>;

  /** Schema или модификатор для input */
  input?: P;

  /** Конфигурация выходных данных */
  output?: O;

  /** Pipeline для этого endpoint */
  pipeline?: Pipeline<I>;
}

export type EndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
> = Omit<EndpointDefinition<I, O, P>, 'handle'>;

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
 * class CreateUserEndpoint implements IEndpoint<
 *   typeof CreateUserSchema,
 *   typeof UserSchema,
 *   { identity: User; payload: unknown }
 * > {
 *   constructor(private users: UserService) {}
 *
 *   async handle(input: { identity: User; payload: CreateUserInput }) {
 *     return Ok.created(await this.users.create(input.payload));
 *   }
 * }
 * ```
 */
export function Endpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
>(metadata: EndpointMetadata<I, O, P>) {
  return <T extends Constructor<IEndpoint<I, O, P>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[HANDLER_KEY] = {
      ...metadata,
      className: context.name,
    };

    // Автоматически регистрируем endpoint в глобальном registry
    registerEndpoint(target as Constructor<IEndpoint<I, O, P>>);

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getEndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
>(target: any): EndpointMetadata<I, O, P> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Вспомогательная функция для создания конфигурации endpoint'а с корректным выводом типов.
 */
export function makeEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
>(definition: EndpointDefinition<I, O, P>): EndpointDefinition<I, O, P> {
  return definition;
}
