/**
 * `unwrap` — частый случай «ожидаю успех» без ручного сужения по
 * `isSuccess`.
 */

import type { ResponseContext } from '@nestling/pipeline';

/**
 * Ошибка `unwrap`: отказ там, где тест ждал успеха.
 *
 * Несёт и `status`, и `code`, и детали: сообщение jest'а должно объяснять
 * провал целиком, без второго запуска под отладчиком.
 */
export class UnwrapFailedError extends Error {
  /** Статус отказа, как его увидел бы транспорт */
  readonly status: string;

  /** Машинный код отказа из закрытого контракта `errors:`, если он есть */
  readonly code?: string;

  /** Детали отказа целиком — то же значение, что в `response.value` */
  readonly details: unknown;

  constructor(response: Extract<ResponseContext, { isSuccess: false }>) {
    const { status, value } = response;

    super(
      `Expected a successful response, got ${status}` +
        `${value.code ? ` (${value.code})` : ''}: ${value.error}`,
    );

    this.name = 'UnwrapFailedError';
    this.status = status;
    this.code = value.code;
    this.details = value;
  }
}

/**
 * Возвращает значение успешного ответа; на отказе — бросает.
 *
 * @param response - Ответ `app.call(...)`
 * @returns Значение ответа по `output`-схеме декларации
 * @throws {UnwrapFailedError} Если ответ — отказ; в сообщении видны
 * `status` и `code`
 *
 * @example
 * ```typescript
 * expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({ id: '1' });
 * ```
 */
export function unwrap<T>(response: ResponseContext<T>): T {
  if (response.isSuccess) {
    return response.value;
  }

  throw new UnwrapFailedError(response);
}
