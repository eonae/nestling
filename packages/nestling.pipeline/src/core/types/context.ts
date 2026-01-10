import type { Readable } from 'node:stream';

import type { AnyInput, AnyMeta, EmptyMeta } from '../io/io';
import type { ErrorStatus, SuccessStatus } from '../status';

import type { Raw } from './raw.js';

// Re-export Raw
export * from './raw.js';

// Re-export типы Meta для удобства
export type { AnyMeta, EmptyMeta } from '../io/io.js';

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
 * Метаданные endpoint (readonly)
 * Доступны middleware для конфигурации (rate limit, audit, cache и т.д.)
 */
export interface EndpointMeta {
  transport: string;
  pattern: string;

  /** Schema для валидации input (zod, yup, etc) */
  input?: unknown;

  /** Schema для output (опционально) */
  output?: unknown;

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
export interface UnvalidatedContext<M extends AnyMeta> {
  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMeta;

  /** Данные от транспорта */
  readonly raw: Raw;

  /** Метаданные, накапливаемые middleware */
  meta: M;
}

/**
 * Контекст ПОСЛЕ валидации
 *
 * ✅ input появляется ТОЛЬКО здесь
 * ✅ input типизирован и провалидирован
 *
 * Middleware после validate() работают с этим контекстом:
 * - Имеют доступ к input (провалидированные данные)
 * - Имеют доступ к raw (всегда присутствует на всех стадиях)
 * - Могут добавлять поля в meta
 */
export interface ValidatedContext<I extends AnyInput, M extends AnyMeta>
  extends UnvalidatedContext<M> {
  /** Провалидированные входные данные */
  readonly input: I;
}

export type AnyContext<I extends AnyInput, M extends AnyMeta> =
  | UnvalidatedContext<M>
  | ValidatedContext<I, M>;

export type EmptyContext = UnvalidatedContext<EmptyMeta>;

export type NextContext<
  C extends AnyContext<I, M>,
  I extends AnyInput,
  M extends AnyMeta,
  N extends M,
> =
  C extends ValidatedContext<I, M> ? ValidatedContext<I, N> : AnyContext<I, N>;

/**
 * Создаёт UnvalidatedContext из Raw
 * Вызывается транспортом после парсинга запроса
 */
export function makeEmptyContext(
  raw: Raw,
  endpoint: EndpointMeta,
): EmptyContext {
  return {
    raw,
    meta: {},
    endpoint,
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
