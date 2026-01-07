import type { Readable } from 'node:stream';

import type { ProcessingStatus } from '../status';

/**
 * Описание файла в multipart запросе
 */
export interface FilePart {
  /** Имя поля формы */
  field: string;

  /** Имя файла */
  filename: string;

  /** MIME-тип */
  mime: string;

  /** Поток данных файла */
  stream: Readable;

  /** Размер файла (если известен) */
  size?: number;
}

/**
 * Абстрактный контекст запроса
 */
export interface RequestContext {
  transport: string;
  pattern: string;

  /**
   * Данные запроса (тип выводится через InferInput)
   */
  payload: unknown;

  /**
   * Метаданные транспорта (headers, auth, tracing)
   */
  metadata?: unknown;
}

/**
 * Абстрактный контекст ответа
 */
export interface ResponseContext<TValue = unknown> {
  /** Статус ответа (строковый для универсальности: 'ok', 'error', etc) */
  status?: ProcessingStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Данные ответа (может быть AsyncIterableIterator для streaming) */
  value: TValue | null;
}

export type Output<TValue = unknown> = Promise<
  ResponseContext<TValue> | TValue
>;
