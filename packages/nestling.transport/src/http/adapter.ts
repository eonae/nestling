import type { ServerResponse } from 'node:http';

import type { ResponseContext } from '../core/interfaces.js';

/**
 * Отправляет ResponseContext в ServerResponse
 */
export function sendResponse(
  res: ServerResponse,
  response: ResponseContext,
): void {
  // Устанавливаем статус код
  res.statusCode = response.status || 200;

  // Устанавливаем заголовки
  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }

  // Если есть stream, отправляем его
  if (response.stream) {
    response.stream.pipe(res);
    return;
  }

  // Иначе отправляем JSON
  if (response.value !== undefined) {
    if (!res.hasHeader('content-type')) {
      res.setHeader('content-type', 'application/json');
    }
    res.end(JSON.stringify(response.value));
    return;
  }

  // Пустой ответ
  res.end();
}
