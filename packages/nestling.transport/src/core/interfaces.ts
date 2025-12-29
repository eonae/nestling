import type { Readable } from 'node:stream';

/**
 * Конфигурация для регистрации handler в транспорте
 */
export interface HandlerConfig {
  transport: string;
  handler: Handler;
  [key: string]: unknown;
}

/**
 * Базовый интерфейс транспорта
 */
export interface Transport {
  /**
   * Регистрирует handler через конфигурацию
   */
  registerHandler(config: HandlerConfig): void;

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
   */
  payload?: unknown;

  /**
   * Метаданные транспорта (headers + transport-specific meta)
   * Используется для auth, tracing и т.п.
   */
  metadata: Record<string, unknown>;

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
export interface ResponseContext {
  status?: number;
  headers?: Record<string, string>;
  value?: unknown;
  stream?: Readable;
  meta: Record<string, unknown>;
}

/**
 * Конфигурация маршрута
 */
export interface RouteConfig {
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  handler: Handler;
}

/**
 * Обработчик запроса
 */
export type Handler = (ctx: RequestContext) => Promise<ResponseContext>;
