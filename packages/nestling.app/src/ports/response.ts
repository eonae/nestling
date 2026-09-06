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
import {
  categoryOf,
  InternalError,
  isCategory,
  isFail,
} from '@nestling/pipeline';

/**
 * Строит ответ-ошибку из исключения.
 *
 * @param error - Брошенное значение: отказ или необработанная ошибка
 */
export function failureResponse(error: unknown): ResponseContext {
  if (isFail(error)) {
    const code =
      typeof error.code === 'string' ? error.code : InternalError.code;
    const category = categoryOf(code);
    const value: ErrorDetails = {
      error: typeof error.message === 'string' ? error.message : 'Error',
      code,
    };

    if (error.details !== undefined) {
      value.details = error.details;
    }

    return {
      isSuccess: false,
      status: isCategory(category) ? category : InternalError.category,
      value,
    };
  }

  // Детали ошибки клиенту не передаются: за границей порта их некому
  // читать, а по сети они и не попали бы дальше
  return {
    isSuccess: false,
    status: InternalError.category,
    value: { error: 'Internal server error', code: InternalError.code },
  };
}
