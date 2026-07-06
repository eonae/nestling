/**
 * Типизированные ошибки входа HTTP-транспорта.
 *
 * Позволяют верхнему catch в `HttpTransport.handle` различать ошибки клиента
 * (битый JSON, конфликт ключей, превышение лимита) и отвечать корректным
 * статусом (400/413) вместо 500, не раскрывая внутренних деталей.
 *
 * Сообщения этих ошибок безопасны для отправки клиенту: они описывают
 * некорректный ввод, а не внутреннее состояние сервера.
 */

/**
 * Тело запроса не является валидным JSON.
 * → `400 Bad Request`, тело `{ "error": "Invalid JSON body" }`.
 */
export class JsonParseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Invalid JSON body', options);
    this.name = 'JsonParseError';
  }
}

/**
 * Одноимённый ключ встречается в нескольких источниках payload
 * (body / query / path-параметры).
 * → `400 Bad Request` с указанием конфликтующего ключа.
 */
export class PayloadConflictError extends Error {
  constructor(public readonly key: string) {
    super(
      `Duplicate key "${key}" found in payload sources ` +
        `(body, query, or params).`,
    );
    this.name = 'PayloadConflictError';
  }
}

/**
 * Буферизуемое тело запроса превысило `maxBodySize`.
 * → `413 Payload Too Large`, тело `{ "error": "Payload too large" }`.
 */
export class PayloadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Одна строка NDJSON-стрима превысила `maxBodySize`.
 * → `413 Payload Too Large` (если ответ ещё не начат).
 */
export class ChunkTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super('Payload too large');
    this.name = 'ChunkTooLargeError';
  }
}
