import type { MaybeSchema } from '@common/misc';
import type { HandlerConfig, HandlerFn } from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
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
  pattern: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
  handle: HandlerFn<P, M, R>;
}
