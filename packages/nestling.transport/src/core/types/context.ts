import type { Readable } from 'node:stream';

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
export interface ResponseContext<TValue = unknown> {
  status?: number;
  headers?: Record<string, string>;
  value?: TValue;
  stream?: Readable;
  meta: Record<string, unknown>;
}
