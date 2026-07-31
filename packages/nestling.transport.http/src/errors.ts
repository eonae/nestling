/**
 * Типизированные ошибки входа HTTP-транспорта.
 *
 * Позволяют верхнему catch в `HttpTransport.handle` различать ошибки клиента
 * (битый JSON, превышение лимита) и отвечать корректным статусом (400/413)
 * вместо 500, не раскрывая внутренних деталей.
 *
 * Класса «конфликт источников payload» здесь нет и не будет: payload
 * собирается strict-приёмом по bind-карте, у каждого поля ровно одно
 * каноническое место — соревноваться источникам не за что.
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

/**
 * Multipart-запрос не соответствует форме декларации: незаявленное
 * файловое поле, неверный MIME, второй файл в single-поле.
 * → `400 Bad Request`; сообщение называет поле и правило.
 *
 * Молча брать первый (или последний) файл транспорт не будет: форма —
 * контракт, а не подсказка.
 */
export class MultipartFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartFieldError';
  }
}
