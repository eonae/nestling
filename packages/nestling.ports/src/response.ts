/**
 * Ответ границы из брошенного значения.
 *
 * Endpoint без пайплайна (`dispatch.call` вызывает `callDirectly`) отказ
 * бросает, а не возвращает, и пайплайн не проверяет его по списку
 * `errors`. Поэтому у каждого транспорта есть своя точка, где исключение
 * становится ответом: у HTTP это `sendError`, у шины и у вызывателя —
 * эта функция. Тело собирается по тем же правилам, что в пайплайне:
 * отказ раскрывает свои `message`, `code` и `details`, необработанная
 * ошибка даёт общее сообщение без `stack`.
 */

import type { ErrorDetails, ResponseContext } from '@nestling/pipeline';
import { isFail } from '@nestling/pipeline';

/**
 * Строит ответ-ошибку из исключения.
 *
 * @param error - Брошенное значение: отказ или необработанная ошибка
 */
export function failureResponse(error: unknown): ResponseContext {
  if (isFail(error)) {
    const value: ErrorDetails = {
      error: typeof error.message === 'string' ? error.message : 'Error',
    };

    if (error.code !== undefined) {
      value.code = error.code;
    }
    if (error.details !== undefined) {
      value.details = error.details;
    }

    return {
      isSuccess: false,
      status: error.status ?? 'INTERNAL_ERROR',
      value,
    };
  }

  // Детали ошибки клиенту не передаются: за границей порта их некому
  // читать, а по сети они и не попали бы дальше
  return {
    isSuccess: false,
    status: 'INTERNAL_ERROR',
    value: { error: 'Internal server error' },
  };
}
