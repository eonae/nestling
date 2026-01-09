import type { Readable } from 'node:stream';

import type { ErrorStatus, SuccessStatus } from '../status';

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
 * Детали ошибки в ResponseContext
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * ResponseContext для успешного ответа
 */
export interface SuccessResponseContext<TValue = unknown> {
  /** Флаг успешного ответа */
  isSuccess: true;

  /** Статус успешного ответа */
  status: SuccessStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Данные успешного ответа (может быть AsyncIterableIterator для streaming) */
  value: TValue;
}

/**
 * ResponseContext для ошибки
 */
export interface ErrorResponseContext {
  /** Флаг успешного ответа */
  isSuccess: false;

  /** Статус ошибки */
  status: ErrorStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Детали ошибки */
  value: ErrorDetails;
}

/**
 * Абстрактный контекст ответа (discriminated union)
 */
export type ResponseContext<TValue = unknown> =
  | SuccessResponseContext<TValue>
  | ErrorResponseContext;
