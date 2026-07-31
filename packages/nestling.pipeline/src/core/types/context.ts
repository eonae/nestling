import type { Readable } from 'node:stream';

import type { AnyFailDefinition } from '../define-fail';
import type { AnyInput, AnyOutput, AnyPayload, EmptyInput } from '../io/io';
import type { StreamSummary } from '../io/summary.js';
import { makeSummary } from '../io/summary.js';
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
 * Метаданные endpoint (readonly)
 * Доступны middleware для конфигурации (rate limit, audit, cache и т.д.)
 */
export interface EndpointMeta {
  transport: string;
  pattern: string;

  /** Конфигурация input: схема, примитив или модификатор */
  input?: AnyPayload;

  /** Конфигурация output: схема, примитив или stream-модификатор */
  output?: AnyOutput;

  /**
   * Объявленные отказы ручки (`errors:` декларации).
   *
   * Единственный источник множества для стража границы: декларация →
   * транспорт → контекст. Глобального реестра отказов нет, поэтому
   * пайплайн, исполненный без декларации, видит пустое множество и
   * контрактными считает только kernel-коды.
   */
  errors?: readonly AnyFailDefinition[];

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

  /**
   * Сигнал отмены запроса. Взводится транспортом (дисконнект клиента)
   * и/или при остановке транспорта (graceful shutdown). Отмена
   * кооперативная: хендлер обязан уважать сигнал сам.
   *
   * Ключ `signal` зарезервирован: pipeline инъецирует этот сигнал в meta
   * хендлера, перекрывая одноимённое поле из input.
   */
  readonly signal: AbortSignal;

  /**
   * Итог запроса: счётчики элементов (заполняет рантайм цепочек) и байты
   * (заполняет транспорт, где знает их).
   *
   * Ссылка read-only, значения — актуальные на момент чтения: объект
   * мутируется рантаймом по мере течения потока. Существует у любой ручки:
   * у не-потоковой счётчики остаются нулями, чтобы наблюдатель не
   * ветвился.
   */
  readonly summary: StreamSummary;

  /** Метаданные, накапливаемые middleware */
  input: I;
}

export type InitialContext = ExtendableContext<EmptyInput>;

/**
 * Сигнал, который никогда не взводится: дефолт для транспортов
 * без собственной семантики отмены.
 */
const NEVER_ABORTED = new AbortController().signal;

/**
 * Создаёт начальный контекст из Raw.
 * Вызывается транспортом после парсинга запроса.
 *
 * @param signal - сигнал отмены запроса; если транспорт его не передал,
 * подставляется never-aborted сигнал, так что `ctx.signal` есть всегда
 * @param input - стартовый input: то, что транспорт кладёт в контекст ещё
 * до первого pre-юнита (например, сырые байты тела при `rawBody: true`).
 * По умолчанию пуст — тип стартового контекста тогда `EmptyInput`.
 */
export function makeEmptyContext<S extends AnyInput = EmptyInput>(
  raw: Raw,
  endpoint: EndpointMeta,
  signal?: AbortSignal,
  input?: S,
): ExtendableContext<S> {
  return {
    endpoint,
    raw,
    signal: signal ?? NEVER_ABORTED,
    summary: makeSummary(),
    input: input ?? ({} as S),
  };
}

/**
 * Детали ошибки в ResponseContext
 */
export interface ErrorDetails {
  error: string;

  /**
   * Машинный код отказа — ось, независимая от статуса.
   *
   * Заполняется рантаймом из `Fail.code`; у отказа без кода поле
   * отсутствует (а не равно `null` или пустой строке). По нему же страж
   * границы решает, контрактен ли ответ.
   */
  code?: string;

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
