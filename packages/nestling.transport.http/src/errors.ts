/**
 * Ошибки входа HTTP-транспорта.
 *
 * По ним `HttpTransport.handle` отличает ошибки клиента (битый JSON,
 * превышение лимита) от внутренних и отвечает статусом 400 или 413
 * вместо 500. Сообщения этих ошибок можно отдавать клиенту: они
 * описывают некорректный ввод, а не состояние сервера.
 */

/**
 * Тело запроса не является валидным JSON.
 *
 * Ответ: `400 Bad Request`, тело `{ "error": "Invalid JSON body" }`.
 */
export class JsonParseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Invalid JSON body', options);
    this.name = 'JsonParseError';
  }
}

/**
 * Буферизуемое тело запроса превысило `maxBodySize`.
 *
 * Ответ: `413 Payload Too Large`, тело `{ "error": "Payload too large" }`.
 */
export class PayloadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Multipart-запрос не соответствует форме декларации: незаявленное
 * файловое поле, неверный MIME, второй файл в одиночном поле.
 *
 * Ответ: `400 Bad Request`; сообщение называет поле и правило.
 */
export class MultipartFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartFieldError';
  }
}
