import type { Readable } from 'node:stream';

import type { AnyInput, EmptyMeta } from '../io/io';
import type { ErrorStatus, SuccessStatus } from '../status';

import type { Raw } from './raw.js';

// Re-export Raw
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
export interface UnvalidatedContext<TMeta extends EmptyMeta = EmptyMeta> {
  /** Данные от транспорта */
  readonly raw: Raw;

  /** Метаданные, накапливаемые middleware */
  meta: TMeta;

  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMeta;
}

/**
 * Контекст ПОСЛЕ валидации
 *
 * ✅ input появляется ТОЛЬКО здесь
 * ✅ input типизирован и провалидирован
 *
 * Middleware после validate() работают с этим контекстом:
 * - Имеют доступ к input (провалидированные данные)
 * - НЕ имеют доступа к raw (он больше не нужен)
 * - Могут добавлять поля в meta
 */
export interface ValidatedContext<
  I extends AnyInput = AnyInput,
  M extends EmptyMeta = EmptyMeta,
> {
  /** Провалидированные входные данные */
  readonly input: I;

  /** Метаданные, накапливаемые middleware */
  meta: M;

  /** Метаданные endpoint (readonly) */
  readonly endpoint: EndpointMeta;
}

export type AnyContext<
  I extends AnyInput = AnyInput,
  M extends EmptyMeta = EmptyMeta,
> = UnvalidatedContext<M> | ValidatedContext<I, M>;

/**
 * Создаёт UnvalidatedContext из Raw
 * Вызывается транспортом после парсинга запроса
 */
export function createUnvalidatedContext(
  raw: Raw,
  endpoint: EndpointMeta,
): UnvalidatedContext {
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
