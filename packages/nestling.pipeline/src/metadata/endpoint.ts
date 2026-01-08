import type { AnyInput, AnyOutput, IEndpoint } from '../core';
import type { HandlerFn } from '../core/types';

import { registerEndpoint } from './endpoint-registry';

import type { Constructor, Optional, Schema } from '@common/misc';

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/* ============================================================
 * Handler-классы с полной проверкой типов
 * ============================================================ */

/**
 * Конфигурация endpoint-класса
 */
export interface EndpointDefinition<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
> {
  transport: string;
  pattern: string;

  handle: HandlerFn<I, O, M>;

  /** Конфигурация входных данных */
  input?: I;

  /** Схема метаданных */
  metadata?: M;

  /** Конфигурация выходных данных */
  output?: O;
}

export type EndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
> = Omit<EndpointDefinition<I, O, M>, 'handle'>;

/**
 * Декоратор для handler-классов с полной проверкой типов.
 *
 * КЛЮЧЕВОЕ ПРЕИМУЩЕСТВО:
 * - TypeScript РЕАЛЬНО проверяет сигнатуру handle()
 * - Типы выводятся АВТОМАТИЧЕСКИ из схем и модификаторов
 * - Нельзя ошибиться в типах параметров!
 * - Один класс = один endpoint (Single Responsibility)
 *
 * @example
 * ```typescript
 * const UserSchema = z.object({ id: z.string() });
 * const MetadataSchema = z.object({ authToken: z.string() });
 * const ResponseSchema = z.object({ name: z.string() });
 *
 * @Handler({
 *   transport: 'http',
 *   pattern: '/users/:id',
 *   input: UserSchema,
 *   metadata: MetadataSchema,
 *   output: ResponseSchema,
 * })
 * class GetUser {
 *   async handle(payload, metadata) {
 *     // payload: { id: string } - выводится автоматически!
 *     // metadata: { authToken: string } - выводится автоматически!
 *
 *     return {
 *       status: 200,
 *       value: { name: "Alice" },
 *       meta: {},
 *     };
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Streaming endpoint
 * @Handler({
 *   transport: 'http',
 *   pattern: 'POST /logs/stream',
 *   input: stream(LogSchema),
 * })
 * class StreamLogsHandler {
 *   async handle(payload: AsyncIterableIterator<Log>) {
 *     // payload: AsyncIterableIterator<Log> - выводится автоматически!
 *     for await (const chunk of payload) {
 *       console.log(chunk);
 *     }
 *     return { status: 200, value: {}, meta: {} };
 *   }
 * }
 * ```
 */
export function Endpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
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
    registerEndpoint(target as Constructor<IEndpoint>);

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getEndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
>(target: any): EndpointMetadata<I, O, M> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Вспомогательная функция для создания конфигурации handler'а с корректным выводом типов.
 *
 * Решает проблему вывода дженерик-типов при явной типизации объекта конфигурации.
 *
 * @example
 * ```typescript
 * const config = makeEndpoint({
 *   transport: 'http',
 *   pattern: '/users',
 *   input: CreateUserSchema,
 *   output: CreateUserResponseSchema,
 *   handle: async (payload) => {
 *     // payload типизирован автоматически!
 *     return { status: 201, value: {...}, meta: {} };
 *   },
 * });
 * ```
 */
export function makeEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
>(definition: EndpointDefinition<I, O, M>): EndpointDefinition<I, O, M> {
  return definition;
}
