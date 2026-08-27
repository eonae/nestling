/**
 * Ответ границы из брошенного значения.
 *
 * Ветка исполнения «без pipeline» отказ **бросает** — стража границы в ней
 * нет (`dispatch.call` → `callDirectly`). Поэтому у каждого транспорта есть
 * своя точка, где исключение становится ответом: у HTTP это `sendError`, у
 * шины и у вызывателя — эта функция. Тело собирается по тем же правилам,
 * что в пайплайне: отказ раскрывает свои `message`/`code`/`details`,
 * необработанная ошибка — generic-сообщение без `stack`.
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

  // Внутренности наружу не уезжают: за границей порта их читать некому,
  // а по проводу они и не поехали бы
  return {
    isSuccess: false,
    status: 'INTERNAL_ERROR',
    value: { error: 'Internal server error' },
  };
}
