import type { Raw } from './raw.js';

import type {
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EmptyInput,
  ErrorStatus,
  StreamSummary,
  SuccessStatus,
} from '@nestling/operations';
import { makeSummary } from '@nestling/operations';

export * from './raw.js';

/**
 * Метаданные endpoint'а. Только для чтения.
 *
 * Доступны юнитам пайплайна для конфигурации: rate limit, audit, cache
 * и подобное.
 */
export interface EndpointMeta {
  transport: string;
  pattern: string;

  /** Конфигурация input: схема, примитив или модификатор */
  input?: AnyPayload;

  /** Конфигурация output: схема, примитив или stream-модификатор */
  output?: AnyOutput;

  /**
   * Объявленные отказы endpoint'а (`errors:` декларации).
   *
   * Единственный источник множества для проверки операции отказов:
   * значение доходит от декларации через транспорт до контекста.
   * Глобального реестра отказов нет, поэтому пайплайн, исполненный без
   * декларации, видит пустое множество и контрактными считает только
   * kernel-коды.
   */
  errors?: readonly AnyFailDefinition[];

  /** Дополнительные опции для юнитов пайплайна */
  [key: string]: unknown;
}

/**
 * Контекст запроса, каким его видят `.pre`-юниты.
 *
 * Юниты читают `raw.payload` и `raw.attributes`, дополняют накопленный
 * `input` и читают `endpoint` для конфигурации. Проверка входа по схеме
 * `input` выполняется после них, поэтому `raw.payload` здесь ещё не
 * проверен.
 *
 * Ключ `payload` в `input` зарезервирован: юнит кладёт туда значение,
 * которое рантайм проверит по схеме `input` вместо `raw.payload` (так
 * распаковывают конверт запроса). В `meta` хендлера этот ключ не
 * попадает.
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
   * мутируется рантаймом по мере течения потока. Существует у любого
   * endpoint'а: у не-потокового счётчики остаются нулями, чтобы
   * наблюдатель не ветвился.
   */
  readonly summary: StreamSummary;

  /** Накопленный input: дополняется pre-юнитами */
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
   * отсутствует (а не равно `null` или пустой строке). По нему же
   * проверка операции отказов решает, контрактен ли ответ.
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

  /**
   * Данные успешного ответа. Для потоковой формы —
   * AsyncIterableIterator.
   */
  value: TValue;
}

/**
 * ResponseContext для ошибки
 */
export interface ErrorResponseContext {
  /** Флаг успеха: у ошибки всегда `false` */
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
