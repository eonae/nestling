import type { EmptyInput } from '../core';
import { RequestId } from '../core';
import type { PreUnitFn } from '../core/types';

/**
 * Добавляет `requestId` в контекст запроса.
 *
 * Извлекает `requestId` из заголовка `x-request-id` или генерирует
 * случайный.
 *
 * Писатель — сама переменная {@link RequestId}: слой, композированный от
 * этого юнита, автоматически удовлетворяет политике
 * `everyEndpoint(…).hasVar(RequestId)`, а глубокий сервис читает значение
 * через `Ctx(RequestId)` — без протаскивания параметром.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(withRequestId());
 * ```
 */
export function withRequestId(): PreUnitFn<EmptyInput, { requestId: string }> {
  return RequestId.provide((ctx) => {
    const requestId = ctx.raw.attributes['x-request-id'];

    return typeof requestId === 'string' ? requestId : crypto.randomUUID();
  });
}
