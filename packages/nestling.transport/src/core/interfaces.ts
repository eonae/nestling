import type { Readable } from 'node:stream';

import type { z } from 'zod';

/**
 * Выводит тип из Zod схемы или возвращает undefined если схема не передана
 */
export type InferPayload<S> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

/**
 * Выводит тип из Zod схемы или возвращает undefined если схема не передана
 */
export type InferMetadata<S> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

/**
 * Выводит тип из Zod схемы или возвращает undefined если схема не передана
 */
export type InferResponse<S> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

export type MaybeSchema = z.ZodTypeAny | undefined;

/**
 * Типизированный контекст для handler'а
 */
export interface TypedHandlerContext<
  TPayload = Record<string, unknown>,
  TMetadata = Record<string, unknown>,
> {
  payload: TPayload;
  metadata: TMetadata;
  transport: string;
  method: string;
  path: string;
  streams?: RequestContext['streams'];
}

/**
 * Конфигурация для регистрации handler в транспорте
 */
export interface HandlerConfig<
  TPayloadSchema extends MaybeSchema = undefined,
  TMetadataSchema extends MaybeSchema = undefined,
  TResponseSchema extends MaybeSchema = undefined,
> {
  transport: string;
  method?: string;
  path: string;
  payloadSchema?: TPayloadSchema;
  metadataSchema?: TMetadataSchema;
  responseSchema?: TResponseSchema;
  handler: HandlerFn<TPayloadSchema, TMetadataSchema, TResponseSchema>;
}

/**
 * Базовый интерфейс транспорта
 */
export interface Transport {
  /**
   * Регистрирует handler через конфигурацию
   */
  registerHandler<
    TPayloadSchema extends MaybeSchema = undefined,
    TMetadataSchema extends MaybeSchema = undefined,
    TResponseSchema extends MaybeSchema = undefined,
  >(
    config: HandlerConfig<TPayloadSchema, TMetadataSchema, TResponseSchema>,
  ): void;

  /**
   * Запускает транспорт (слушает входящие соединения/команды)
   */
  listen(...args: unknown[]): Promise<void>;

  /**
   * Останавливает транспорт
   */
  close?(): Promise<void>;
}

/**
 * Описание файла в multipart запросе
 */
export interface FilePart {
  field: string;
  filename: string;
  mime: string;
  stream: Readable;
}

/**
 * Абстрактный контекст запроса
 */
export interface RequestContext {
  transport: string;
  method: string;
  path: string;

  /**
   * Структурированные данные (объединение body + query + params)
   * Используется со schema-driven подходом
   * undefined если схема не передана
   */
  payload?: unknown;

  /**
   * Метаданные транспорта (headers + transport-specific meta)
   * Используется для auth, tracing и т.п.
   * undefined если схема не передана
   */
  metadata?: unknown;

  /**
   * Для streaming cases
   */
  streams?: {
    /** Streaming body (когда body не парсится в объект) */
    body?: Readable;
    /** Multipart файлы */
    files?: FilePart[];
  };
}

/**
 * Абстрактный контекст ответа
 */
export interface ResponseContext<TValue = undefined> {
  status?: number;
  headers?: Record<string, string>;
  value?: TValue;
  stream?: Readable;
  meta: Record<string, unknown>;
}

/**
 * Конфигурация маршрута
 */
export interface RouteConfig<
  TPayloadSchema extends MaybeSchema = undefined,
  TMetadataSchema extends MaybeSchema = undefined,
  TResponseSchema extends MaybeSchema = undefined,
> {
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
  handler: HandlerFn<TPayloadSchema, TMetadataSchema, TResponseSchema>;
}

/**
 * Обработчик запроса (функциональный стиль)
 */
export type HandlerFn<
  TPayloadSchema extends MaybeSchema = undefined,
  TMetadataSchema extends MaybeSchema = undefined,
  TResponseSchema extends MaybeSchema = undefined,
> = (
  payload: InferPayload<TPayloadSchema>,
  metadata: InferMetadata<TMetadataSchema>,
) => Promise<ResponseContext<InferResponse<TResponseSchema>>>;

/**
 * Вспомогательная функция для создания конфигурации handler'а с корректным выводом типов.
 *
 * Решает проблему вывода дженерик-типов при явной типизации объекта конфигурации.
 *
 * @example
 * ```typescript
 * const config = defineHandler({
 *   transport: 'http',
 *   method: 'POST',
 *   path: '/users',
 *   payloadSchema: CreateUserSchema,
 *   responseSchema: CreateUserResponseSchema,
 *   handler: async (payload) => {
 *     // payload типизирован автоматически!
 *     return { status: 201, value: {...}, meta: {} };
 *   },
 * });
 * ```
 */
export function defineHandler<
  TPayloadSchema extends MaybeSchema = undefined,
  TMetadataSchema extends MaybeSchema = undefined,
  TResponseSchema extends MaybeSchema = undefined,
>(
  config: HandlerConfig<TPayloadSchema, TMetadataSchema, TResponseSchema>,
): HandlerConfig<TPayloadSchema, TMetadataSchema, TResponseSchema> {
  return config as HandlerConfig<
    TPayloadSchema,
    TMetadataSchema,
    TResponseSchema
  >;
}
