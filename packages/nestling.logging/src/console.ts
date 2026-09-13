/**
 * Штатный логгер: каждая запись уходит в `process.stderr` одной строкой.
 *
 * `stderr`, а не `stdout`: у CLI-транспорта `stdout` занят результатом
 * команды, и лог не должен в него попадать.
 *
 * Строку печатает `formatLine` из `./format.js` — та же функция, которой
 * печатает сателлит логирования. Класс реализации наружу не идёт — пакет
 * отдаёт фабрику {@link makeConsoleLogger}. Полей корреляции логгер не
 * ставит: их подмешивает декоратор корня из `@nestlingjs/app`, а скрипт
 * вне приложения запроса не обрабатывает.
 */

import type { LogEntry, LogFormat } from './format.js';
import { formatLine, serializeError } from './format.js';
import type { Fields, Logger, LogLevel, LogMethod } from './interface.js';

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
interface Parsed {
  readonly message?: string;
  readonly fields: Fields;
}

/**
 * Разбирает форму вызова.
 *
 * Ошибка первым аргументом даёт сообщение из `error.message` и саму
 * ошибку в `err`; поля второго аргумента не могут её перекрыть.
 */
function toParsed(first: FirstArgument, second?: Fields): Parsed {
  if (typeof first === 'string') {
    return { message: first, fields: second ?? {} };
  }

  if (first instanceof Error) {
    return { message: first.message, fields: { ...second, err: first } };
  }

  return { fields: first };
}

/**
 * Штатный логгер: порог и формат из опций, записи в `process.stderr`.
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

    const { message, fields } = toParsed(first, second);
    const { err, ...rest } = fields;

    // Порядок полей и есть порядок в строке: привязки (`scope` среди них),
    // затем поля вызова. Ошибка сериализуется до формата: формату всё
    // равно, дожил ли до него живой `Error`
    const data: Fields = { ...this.#bindings, ...rest };

    if ('err' in fields) {
      data.err = serializeError(err);
    }

    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      message,
      fields: data,
    };

    process.stderr.write(`${formatLine(entry, this.#format)}\n`);
  }
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
