/**
 * Штатный логгер: каждая запись уходит в `process.stderr` одной строкой.
 *
 * `stderr`, а не `stdout`: у CLI-транспорта `stdout` занят результатом
 * команды, и лог не должен в него попадать.
 *
 * Класс реализации наружу не идёт — пакет отдаёт фабрику
 * {@link makeConsoleLogger}. Полей корреляции логгер не ставит: их
 * подмешивает декоратор корня из `@nestlingjs/app`, а скрипт вне
 * приложения запроса не обрабатывает.
 */

import type { Fields, Logger, LogLevel, LogMethod } from './interface.js';

/** Формат строки в `stderr` */
export type LogFormat = 'text' | 'json';

/**
 * Порог записи: уровень или `silent`.
 *
 * `silent` отсекает все четыре уровня. Уровнем записи он не бывает: в
 * `LogLevel` его нет, потому что писать им нечем.
 */
export type LogThreshold = LogLevel | 'silent';

/** Опции штатного логгера */
export interface ConsoleLoggerOptions {
  /** Порог записи; умолчание — `info` */
  readonly level?: LogThreshold;

  /** Формат строки; умолчание — `text` */
  readonly format?: LogFormat;
}

/** Опции с подставленными умолчаниями — то, с чем работает реализация */
interface ResolvedOptions {
  readonly level: LogThreshold;
  readonly format: LogFormat;
}

/** Порядок уровней: запись ниже порога отбрасывается */
const RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Порог: `silent` стоит выше любого уровня, поэтому под него не проходит ничто */
const THRESHOLD: Readonly<Record<LogThreshold, number>> = {
  ...RANK,
  silent: 4,
};

/** Первый аргумент метода уровня: одна из трёх форм вызова */
type FirstArgument = string | Error | Fields;

/** Запись, разобранная из формы вызова */
interface Entry {
  readonly message?: string;
  readonly fields: Fields;
}

/**
 * Разбирает форму вызова.
 *
 * Ошибка первым аргументом даёт сообщение из `error.message` и саму
 * ошибку в `err`; поля второго аргумента не могут её перекрыть.
 */
function toEntry(first: FirstArgument, second?: Fields): Entry {
  if (typeof first === 'string') {
    return { message: first, fields: second ?? {} };
  }

  if (first instanceof Error) {
    return { message: first.message, fields: { ...second, err: first } };
  }

  return { fields: first };
}

/**
 * Сериализует ошибку полями: `name`, `message`, `stack`, `cause`.
 *
 * Значение, которое не является `Error`, отдаётся как есть: реализация
 * сериализует ключ `err` как ошибку, но не выдумывает её.
 */
function serializeError(err: unknown): unknown {
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
  if (!(err instanceof Error)) {
    return formatValue(err);
  }

  // Первая строка стека Node — это `name: message`; она уже напечатана
  const stackLines = err.stack?.split('\n').slice(1) ?? [];
  let out = `${err.name}: ${err.message}`;

  for (const line of stackLines) {
    out += `\n${line}`;
  }

  if (err.cause !== undefined) {
    out += `\n    caused by: ${formatError(err.cause)}`;
  }

  return out;
}

/**
 * Штатный логгер: порог и формат из опций, записи в `process.stderr`.
 *
 * - `text`: `<время ISO> <УРОВЕНЬ> <scope> <сообщение> key=value …`;
 *   значения-объекты через `JSON.stringify`; `err` — `err=<name>: <message>`
 *   и стек на следующих строках.
 * - `json`: одна строка с полями `time`, `level`, привязками, `msg`,
 *   полями вызова и `err` в виде `{ name, message, stack, cause? }`.
 *
 * Ячейку запроса логгер не читает: поля корреляции ставит декоратор
 * корня, и любая другая реализация получает их тем же способом.
 */
class ConsoleLogger implements Logger {
  readonly #options: ResolvedOptions;
  readonly #bindings: Fields;
  readonly #threshold: number;
  readonly #format: LogFormat;

  constructor(options: ResolvedOptions, bindings: Fields = {}) {
    this.#options = options;
    this.#bindings = bindings;
    this.#threshold = THRESHOLD[options.level];
    this.#format = options.format;
  }

  readonly debug: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('debug', first, second);

  readonly info: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('info', first, second);

  readonly warn: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('warn', first, second);

  readonly error: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('error', first, second);

  /** Дочерний логгер с теми же опциями и объединёнными привязками */
  child(bindings: Fields): Logger {
    return new ConsoleLogger(this.#options, {
      ...this.#bindings,
      ...bindings,
    });
  }

  #write(level: LogLevel, first: FirstArgument, second?: Fields): void {
    if (RANK[level] < this.#threshold) {
      return;
    }

    const { message, fields } = toEntry(first, second);
    const { err, ...rest } = fields;

    // Порядок полей и есть порядок в строке: время, уровень, привязки
    // (`scope` среди них), сообщение, поля вызова, ошибка
    const data: Record<string, unknown> = { ...this.#bindings, ...rest };

    const time = new Date().toISOString();
    const line =
      this.#format === 'json'
        ? formatJson(time, level, message, data, 'err' in fields, err)
        : formatText(time, level, message, data, 'err' in fields, err);

    process.stderr.write(`${line}\n`);
  }
}

/** Строка формата `json` */
function formatJson(
  time: string,
  level: LogLevel,
  message: string | undefined,
  data: Record<string, unknown>,
  hasError: boolean,
  err: unknown,
): string {
  const { scope, ...bindingsAndFields } = data;
  const record: Record<string, unknown> = { time, level };

  if (scope !== undefined) {
    record.scope = scope;
  }

  // Сообщение стоит после привязок и перед полями вызова; привязки и поля
  // здесь уже слиты в `data`, и разделять их обратно незачем: порядок
  // ключей важен читателю, а не парсеру
  if (message !== undefined) {
    record.msg = message;
  }

  Object.assign(record, bindingsAndFields);

  if (hasError) {
    record.err = serializeError(err);
  }

  return toJson(record);
}

/** Строка формата `text` */
function formatText(
  time: string,
  level: LogLevel,
  message: string | undefined,
  data: Record<string, unknown>,
  hasError: boolean,
  err: unknown,
): string {
  const { scope, ...rest } = data;
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

  if (hasError) {
    parts.push(`err=${formatError(err)}`);
  }

  return parts.join(' ');
}

/**
 * Создаёт штатный логгер: записи уходят в `process.stderr` одной строкой
 * каждая.
 *
 * Его берут и приложение умолчанием корня, и код вне приложения: скрипт
 * генерации, миграция, standalone-диспетчер. Формат строки один и тот же,
 * поэтому вывод скрипта читается тем же глазом и тем же грепом, что и
 * вывод сервиса.
 *
 * @param options - Порог записи и формат строки; умолчания `info` и `text`
 * @returns Логгер
 *
 * @example
 * ```typescript
 * const logger = makeConsoleLogger({ format: 'json' });
 *
 * logger.info('document written', { path });
 * ```
 */
export const makeConsoleLogger = (options: ConsoleLoggerOptions = {}): Logger =>
  new ConsoleLogger({
    level: options.level ?? 'info',
    format: options.format ?? 'text',
  });
