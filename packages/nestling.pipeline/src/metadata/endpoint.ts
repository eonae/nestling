import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  IEndpoint,
  Pipeline,
} from '../core';
import type { HandlerFn } from '../core/types';

import type { Constructor } from '@common/misc';

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/**
 * Конфигурация endpoint-класса
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - выходной тип pipeline (накопленные middleware поля)
 */
export interface EndpointDefinition<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> {
  transport: string;
  pattern: string;

  handle: HandlerFn<I, O, P>;

  /** Schema или модификатор для input */
  input?: I;

  /** Конфигурация выходных данных */
  output?: O;

  /**
   * Pipeline для этого endpoint.
   *
   * `TNeeds = never`: пайплайн с классами-юнитами сначала резолвится
   * (`bind`) — App делает это автоматически на старте; standalone-транспорт
   * принимает только исполнимый пайплайн.
   */
  pipeline?: Pipeline<AnyInput, P, never>;
}

export type EndpointMetadata<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> = Omit<EndpointDefinition<I, O, P>, 'handle' | 'pipeline'> & {
  /**
   * Pipeline endpoint'а. В отличие от `EndpointDefinition`, допускает
   * классы-юниты (`TNeeds` ≠ never): App резолвит их контейнером
   * на старте (`bind`). Standalone-транспорт принимает только
   * исполнимый пайплайн.
   */
  pipeline?: Pipeline<AnyInput, P, unknown>;
};

/**
 * Декоратор для endpoint-классов с типизированным pipeline.
 *
 * @example
 * ```typescript
 * const authPipeline = makePipeline()
 *   .pre(withIdentity<User>(verifyToken))
 *   .pre(validate());
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
 *   { identity: User }
 * > {
 *   constructor(private users: UserService) {}
 *
 *   async handle(payload: CreateUserInput, meta: { identity: User }) {
 *     return Ok.created(await this.users.create(payload));
 *   }
 * }
 * ```
 */
export function Endpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
>(metadata: EndpointMetadata<I, O, P>) {
  return <T extends Constructor<IEndpoint<I, O, P>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса. Дискавери идёт обходом
    // дерева зарегистрированных модулей: декоратор только пишет метаданные
    // и ни в какой глобальный реестр класс не кладёт
    (target as any)[HANDLER_KEY] = {
      ...metadata,
      className: context.name,
    };

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getEndpointMetadata<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
>(target: any): EndpointMetadata<I, O, P> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Вспомогательная функция для создания конфигурации endpoint'а с корректным выводом типов.
 */
export function makeEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
>(definition: EndpointDefinition<I, O, P>): EndpointDefinition<I, O, P> {
  return definition;
}
