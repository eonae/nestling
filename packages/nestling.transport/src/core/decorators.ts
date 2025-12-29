import type { MaybeSchema, ResponseContext } from './interfaces.js';

import type { z } from 'zod';

/**
 * Метаданные handler-класса
 */
export interface HandlerMetadata {
  transport: string;
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: MaybeSchema;
  metadataSchema?: MaybeSchema;
  responseSchema?: MaybeSchema;
  className: string;
}

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/* ============================================================
 * Handler-классы с полной проверкой типов
 * ============================================================ */

/**
 * Контракт handler-класса.
 *
 * Класс ОБЯЗАН иметь метод handle с правильной сигнатурой.
 * TypeScript проверяет это на уровне типов!
 */
export type HandlerClass<TPayload, TMetadata, TResponse> = new (
  ...args: any[]
) => {
  /**
   * Обязательный метод handler-а.
   * Его сигнатура — часть type-level контракта.
   */
  handle(
    payload: TPayload,
    metadata: TMetadata,
  ): Promise<ResponseContext<TResponse>>;
};

/**
 * Конфигурация handler-класса
 */
export interface HandlerClassConfig<
  TPayloadSchema extends MaybeSchema,
  TMetadataSchema extends MaybeSchema,
  TResponseSchema extends MaybeSchema,
> {
  transport: string;
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: TPayloadSchema;
  metadataSchema?: TMetadataSchema;
  responseSchema?: TResponseSchema;
}

/**
 * Декоратор для handler-классов с полной проверкой типов.
 *
 * КЛЮЧЕВОЕ ПРЕИМУЩЕСТВО:
 * - TypeScript РЕАЛЬНО проверяет сигнатуру handle()
 * - Типы выводятся АВТОМАТИЧЕСКИ из схем
 * - Нельзя ошибиться в типах параметров!
 * - Один класс = один endpoint (Single Responsibility)
 *
 * @example
 * ```typescript
 * const PayloadSchema = z.object({ id: z.string() });
 * const MetadataSchema = z.object({ authToken: z.string() });
 * const ResponseSchema = z.object({ name: z.string() });
 *
 * @Handler({
 *   transport: 'http',
 *   method: 'GET',
 *   path: '/users/:id',
 *   payloadSchema: PayloadSchema,
 *   metadataSchema: MetadataSchema,
 *   responseSchema: ResponseSchema,
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
 */
export function Handler<
  TPayloadSchema extends MaybeSchema,
  TMetadataSchema extends MaybeSchema,
  TResponseSchema extends MaybeSchema,
>(
  config: HandlerClassConfig<TPayloadSchema, TMetadataSchema, TResponseSchema>,
) {
  // Выводим типы из схем
  type Payload = z.infer<TPayloadSchema>;
  type Metadata = z.infer<TMetadataSchema>;
  type Response = z.infer<TResponseSchema>;

  return <T extends HandlerClass<Payload, Metadata, Response>>(
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
export function getHandlerMetadata(target: any): HandlerMetadata | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}
