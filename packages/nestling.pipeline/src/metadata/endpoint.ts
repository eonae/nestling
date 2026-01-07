import type {
  AnyInput,
  AnyOutput,
  InferInput,
  InferOutput,
  ResponseContext,
} from '../core';

import type { Constructor, Infer, Optional, Schema } from '@common/misc';

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
export interface EndpointMetadata<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> {
  transport: string;
  pattern: string;

  /** Конфигурация входных данных */
  input?: I;

  /** Схема метаданных */
  metadata?: M;

  /** Конфигурация выходных данных */
  output?: O;
}

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
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(config: EndpointMetadata<I, O, M>) {
  return <
    T extends Constructor<{
      handle(
        payload: InferInput<I>,
        metadata: Infer<M>,
      ): Promise<ResponseContext<InferOutput<O>> | InferOutput<O>>;
    }>,
  >(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[HANDLER_KEY] = {
      ...config,
      className: context.name,
    };

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getEndpointMetadata<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(target: any): EndpointMetadata<I, O, M> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}
