/**
 * Формат записи: `formatLine` печатает строку, `serializeError` готовит к
 * ней ошибку.
 *
 * Формат публичный, потому что печатают им двое. Штатный логгер зовёт
 * `formatLine` сам; реализация поверх сторонней библиотеки —
 * `@nestlingjs/logging.pino` — зовёт её же. Совпадение вывода держится
 * тем, что реализация формата одна, а не сверкой двух копий.
 *
 * Ошибка приходит в `formatLine` уже сериализованной: у реализации поверх
 * чужой библиотеки запись доходит до писателя строкой, и живого `Error`
 * в ней нет.
 */

import type { Fields, LogLevel } from './interface.js';

/** Формат строки в `stderr` */
export type LogFormat = 'text' | 'json';

/** Запись, готовая к печати */
export interface LogEntry {
  /** Время записи строкой ISO */
  readonly time: string;

  readonly level: LogLevel;

  /** Сообщение; у формы вызова с одними полями его нет */
  readonly message?: string;

  /**
   * Привязки и поля вызова в том порядке, в каком они идут в строке.
   *
   * Ключ `scope` печатается перед сообщением, ключ `err` — последним;
   * остальные идут как есть. Ошибка в `err` ожидается сериализованной.
   */
  readonly fields: Fields;
}

/**
 * Сериализует ошибку полями: `name`, `message`, `stack`, `cause`.
 *
 * Значение, которое не является `Error`, отдаётся как есть: реализация
 * сериализует ключ `err` как ошибку, но не выдумывает её.
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) {
    return err;
  }

  const out: Record<string, unknown> = { name: err.name, message: err.message };

  if (err.stack) {
    out.stack = err.stack;
  }

  if (err.cause !== undefined) {
    out.cause = serializeError(err.cause);
  }

  return out;
}

/**
 * Печатает запись строкой выбранного формата. Перевода строки в конце нет:
 * его ставит тот, кто пишет в поток.
 *
 * - `text`: `<время ISO> <УРОВЕНЬ> <scope> <сообщение> key=value …`;
 *   значения-объекты через `JSON.stringify`; `err` — `err=<name>: <message>`
 *   и стек на следующих строках.
 * - `json`: одна строка с ключами `time`, `level`, `scope`, `msg`, полями
 *   и `err`.
 *
 * @param entry - Запись: время, уровень, сообщение и поля
 * @param format - Формат строки
 * @returns Строка записи
 *
 * @example
 * ```typescript
 * const line = formatLine(
 *   { time: new Date().toISOString(), level: 'info', message: 'ready', fields: {} },
 *   'text',
 * );
 * ```
 */
export function formatLine(entry: LogEntry, format: LogFormat): string {
  return format === 'json' ? formatJson(entry) : formatText(entry);
}

/** Сериализованный вид ошибки — то, что отдаёт {@link serializeError} */
interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

/**
 * Распознаёт сериализованный вид ошибки: имя и сообщение строками.
 *
 * Живой `Error` проходит той же проверкой, поэтому формат печатает и его.
 */
function asSerializedError(value: unknown): SerializedError | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const { name, message } = value as Record<string, unknown>;

  return typeof name === 'string' && typeof message === 'string'
    ? (value as SerializedError)
    : undefined;
}

/** Замена для значений, которые `JSON.stringify` не переносит */
const replacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * `JSON.stringify`, который не роняет запись.
 *
 * Циклическая ссылка в поле — ошибка вызывающего, но терять из-за неё
 * запись целиком нельзя: повторная встреча объекта помечается строкой.
 */
function toJson(value: unknown): string {
  try {
    return JSON.stringify(value, replacer);
  } catch {
    const seen = new WeakSet<object>();

    return JSON.stringify(value, (key, item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {
          return '[Circular]';
        }

        seen.add(item);
      }

      return replacer(key, item);
    });
  }
}

/** Значение поля в текстовом формате: скаляры как есть, объекты — JSON */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value === '' || /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return toJson(value);
}

/**
 * Ошибка в текстовом формате: `<name>: <message>`, стек на следующих
 * строках, причина — после стека.
 */
function formatError(err: unknown): string {
  const error = asSerializedError(err);

  if (!error) {
    return formatValue(err);
  }

  // Первая строка стека Node — это `name: message`; она уже напечатана
  const stackLines = error.stack?.split('\n').slice(1) ?? [];
  let out = `${error.name}: ${error.message}`;

  for (const line of stackLines) {
    out += `\n${line}`;
  }

  if (error.cause !== undefined) {
    out += `\n    caused by: ${formatError(error.cause)}`;
  }

  return out;
}

/** Строка формата `json` */
function formatJson({ time, level, message, fields }: LogEntry): string {
  const { scope, err, ...rest } = fields;
  const record: Record<string, unknown> = { time, level };

  if (scope !== undefined) {
    record.scope = scope;
  }

  // Сообщение стоит после привязок и перед полями вызова; привязки и поля
  // здесь уже слиты в `fields`, и разделять их обратно незачем: порядок
  // ключей важен читателю, а не парсеру
  if (message !== undefined) {
    record.msg = message;
  }

  Object.assign(record, rest);

  if ('err' in fields) {
    record.err = err;
  }

  return toJson(record);
}

/** Строка формата `text` */
function formatText({ time, level, message, fields }: LogEntry): string {
  const { scope, err, ...rest } = fields;
  const parts = [time, level.toUpperCase().padEnd(5)];

  if (scope !== undefined) {
    parts.push(String(scope));
  }

  if (message !== undefined) {
    parts.push(message);
  }

  for (const [key, value] of Object.entries(rest)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  if ('err' in fields) {
    parts.push(`err=${formatError(err)}`);
  }

  return parts.join(' ');
}
