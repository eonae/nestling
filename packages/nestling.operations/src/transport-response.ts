import type { OutputSync } from './output.js';
import type { AnyFail } from './result.js';
import type { SuccessStatus } from './status.js';

/**
 * Метка конверта транспортного ответа.
 *
 * `Symbol.for`, а не уникальный символ: две копии пакета в одном процессе
 * дают один и тот же символ, и конверт из чужой копии распознаётся.
 */
export const TRANSPORT_RESPONSE: unique symbol = Symbol.for(
  'nestling:transport-response',
);

/**
 * Ответ, оформленный транспортом: результат плюс метаданные протокола.
 *
 * Конверт — точка расширения ядра. `@nestlingjs/app` разбирает `result` тем
 * же кодом, что и обычный ответ, а `meta` не читает: их понимает только
 * транспорт, чьё имя стоит в `transport`.
 *
 * Конверт не входит в `OutputSync`, поэтому хендлер, не знающий
 * транспорта, вернуть его не может.
 *
 * @param TValue - Тип значения ответа
 * @param TStatus - Статус исхода, который несёт результат
 */
export interface TransportResponse<
  TValue = unknown,
  TStatus extends SuccessStatus = SuccessStatus,
> {
  /** Метка конверта; по ней его распознаёт рантайм пайплайна */
  readonly [TRANSPORT_RESPONSE]: true;

  /** Имя транспорта, который понимает `meta` */
  readonly transport: string;

  /** Метаданные протокола; ядро их не читает */
  readonly meta: unknown;

  /** Ответ без метаданных: `Ok` или значение */
  readonly result: OutputSync<TValue, AnyFail, TStatus>;
}

/**
 * Проверяет, что значение — конверт транспортного ответа.
 *
 * Проверка по метке, а не по `instanceof`: класс конверта живёт в пакете
 * транспорта, которого ядро не знает.
 */
export function isTransportResponse(
  value: unknown,
): value is TransportResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[TRANSPORT_RESPONSE] === true
  );
}
