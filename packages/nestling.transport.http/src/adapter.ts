import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { ProcessingStatus, ResponseContext } from '@nestling/pipeline';

/**
 * Маппинг строковых статусов на HTTP коды
 */
/* eslint-disable prettier/prettier */
const STATUS_MAP: Record<ProcessingStatus, number> = {
  'OK': 200,
  'CREATED': 201,
  'ACCEPTED': 202,
  'NO_CONTENT': 204,
  'PAYMENT_REQUIRED': 402,
  'BAD_REQUEST': 400,
  'UNAUTHORIZED': 401,
  'FORBIDDEN': 403,
  'NOT_FOUND': 404,
  'INTERNAL_ERROR': 500,
  'NOT_IMPLEMENTED': 501,
  'SERVICE_UNAVAILABLE': 503,
};
/* eslint-enable prettier/prettier */

/**
 * Парсит строковый статус в HTTP код
 */
function parseStatus(status?: ProcessingStatus): number {
  if (!status) {
    return 200;
  }

  // Иначе используем маппинг
  return STATUS_MAP[status] ?? 200;
}

/**
 * Отправляет ResponseContext в ServerResponse
 */
export function sendResponse(
  res: ServerResponse,
  response: ResponseContext,
): void {
  // Устанавливаем статус код
  res.statusCode = parseStatus(response.status);

  // Устанавливаем заголовки
  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }

  // Если value === null - пустой ответ
  if (response.value === null) {
    res.end();
    return;
  }

  // Если value является AsyncIterableIterator - конвертируем в stream
  if (
    response.value &&
    typeof response.value === 'object' &&
    Symbol.asyncIterator in response.value
  ) {
    Readable.from(response.value as AsyncIterable<any>).pipe(res);
    return;
  }

  // Иначе отправляем JSON
  if (!res.hasHeader('content-type')) {
    res.setHeader('content-type', 'application/json');
  }
  res.end(JSON.stringify(response.value));
}
