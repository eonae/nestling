import type { HandlerFn, MaybeSchema } from './types';

/**
 * Конфигурация для регистрации handler в транспорте
 */
export interface HandlerConfig<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  transport: string;
  method?: string;
  path: string;
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
  handler: HandlerFn<P, M, R>;
}

/**
 * Базовый интерфейс транспорта
 */
export interface Transport {
  /**
   * Регистрирует handler через конфигурацию
   */
  registerHandler<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(
    config: HandlerConfig<P, M, R>,
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
 * Конфигурация маршрута
 */
export interface RouteConfig<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
  handler: HandlerFn<P, M, R>;
}

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
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
>(config: HandlerConfig<P, M, R>): HandlerConfig<P, M, R> {
  return config as HandlerConfig<P, M, R>;
}
