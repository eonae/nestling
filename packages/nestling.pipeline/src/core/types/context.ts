import type { Readable } from 'node:stream';

import type { AnyInput, EmptyInput } from '../io/io';
import type { ErrorStatus, SuccessStatus } from '../status';

import type { Raw } from './raw.js';

export * from './raw.js';

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
 * Интерфейс для схемы валидации (zod-совместимый)
 */
export interface Schema<T> {
  parse(data: unknown): T;
}

/**
 * Метаданные endpoint (readonly)
 * Доступны middleware для конфигурации (rate limit, audit, cache и т.д.)
 */
export interface EndpointMeta {
  transport: string;
  pattern: string;

  /** Schema для валидации input (zod, yup, etc) */
  input?: Schema<unknown>;

  /** Schema для output (опционально) */
  output?: Schema<unknown>;

  /** Дополнительные опции для middleware */
  [key: string]: unknown;
}

/**
 * Контекст ДО валидации
 *
 * ❗ input НЕ существует на этом этапе
 * ❗ Есть только raw.payload
 *
 * Middleware до validate() работают с этим контекстом:
 * - Могут читать raw.payload и raw.attributes
 * - Могут добавлять поля в meta
 * - Могут читать endpoint для конфигурации
 */
export interface ExtendableContext<I extends AnyInput> {
  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMeta;

  /** Данные от транспорта */
  readonly raw: Raw;

  /** Метаданные, накапливаемые middleware */
  input: I;
}

export type InitialContext = ExtendableContext<EmptyInput>;

/**
 * Создаёт UnvalidatedContext из Raw
 * Вызывается транспортом после парсинга запроса
 */
export function makeEmptyContext(
  raw: Raw,
  endpoint: EndpointMeta,
): InitialContext {
  return {
    endpoint,
    raw,
    input: {},
  };
}

/**
 * Детали ошибки в ResponseContext
 */
export interface ErrorDetails {
  error: string;
  details?: unknown;
  stack?: string;
}

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
export type ResponseContext<O = unknown> =
  | SuccessResponseContext<O>
  | ErrorResponseContext;
