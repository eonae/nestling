/**
 * `pinoLogger` — реализация `Logger` поверх настоящего экземпляра pino.
 *
 * Экземпляр создаёт адаптер, а не вызывающий: он приносил бы своё
 * назначение и свои имена ключей, и обещание формата превратилось бы в
 * инструкцию «настройте pino вот так». Остальные опции библиотеки —
 * redaction, сериализаторы, семплирование — уходят полем `pino` как есть.
 */

import type { OwnedKey } from './owned.js';
import { assertNotOwned } from './owned.js';
import { makeDestination } from './writer.js';

import type {
  Fields,
  LogFormat,
  Logger,
  LogLevel,
  LogMethod,
  LogThreshold,
} from '@nestlingjs/logging';
import { serializeError } from '@nestlingjs/logging';
import type { Logger as PinoInstance, LoggerOptions } from 'pino';
import pino from 'pino';

/** Опции адаптера */
export interface PinoLoggerOptions {
  /**
   * Порог записи; умолчание — `info`.
   *
   * Вдобавок к уровням интерфейса принимает уровни pino: `trace`
   * отображается на `debug`, `fatal` — на `error`. В `Logger` четыре
   * уровня, и писать пятым нечем.
   */
  readonly level?: LogThreshold | 'trace' | 'fatal';

  /** Формат строки; умолчание — `text` */
  readonly format?: LogFormat;

  /** Остальные опции pino: redaction, сериализаторы, семплирование */
  readonly pino?: Omit<LoggerOptions, OwnedKey>;
}

/** Порог адаптера на пороге pino: два уровня pino ложатся на четыре */
const THRESHOLD: Readonly<
  Record<LogThreshold | 'trace' | 'fatal', LogThreshold>
> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
  silent: 'silent',
};

/** Первый аргумент метода уровня: одна из трёх форм вызова */
type FirstArgument = string | Error | Fields;

/**
 * `Logger` поверх экземпляра pino.
 *
 * Три формы вызова ложатся на две формы pino: поля уходят объектом,
 * сообщение — строкой. Ошибка первым аргументом даёт сообщение из
 * `error.message` и саму ошибку в `err`; поля второго аргумента не могут
 * её перекрыть — то же правило, что у штатного логгера.
 */
class PinoAdapter implements Logger {
  readonly #pino: PinoInstance;

  constructor(instance: PinoInstance) {
    this.#pino = instance;
  }

  readonly debug: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('debug', first, second);

  readonly info: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('info', first, second);

  readonly warn: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('warn', first, second);

  readonly error: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('error', first, second);

  /** Дочерний логгер поверх `pino.child`: привязки идут раньше полей вызова */
  child(bindings: Fields): Logger {
    return new PinoAdapter(this.#pino.child(bindings));
  }

  #write(level: LogLevel, first: FirstArgument, second?: Fields): void {
    if (typeof first === 'string') {
      this.#pino[level](second ?? {}, first);

      return;
    }

    if (first instanceof Error) {
      this.#pino[level]({ ...second, err: first }, first.message);

      return;
    }

    this.#pino[level](first);
  }
}

/**
 * Создаёт логгер поверх pino: записи уходят в `stderr` одной строкой
 * каждая.
 *
 * Формат `text` совпадает со штатным логгером до байта: строку печатает
 * `formatLine` из `@nestlingjs/logging`. Формат `json` пишет сам pino —
 * ключи те же, порядок его.
 *
 * @param options - Порог, формат и остальные опции pino
 * @returns Логгер
 * @throws TypeError - В поле `pino` передан ключ, занятый адаптером
 *
 * @example
 * ```typescript
 * const app = await makeApp({
 *   // …
 *   logging: { logger: pinoLogger({ format: 'json', pino: { redact: ['password'] } }) },
 * });
 * ```
 */
export function pinoLogger(options: PinoLoggerOptions = {}): Logger {
  const { level = 'info', format = 'text', pino: rest = {} } = options;

  assertNotOwned(rest);

  return new PinoAdapter(
    pino(
      {
        ...rest,
        level: THRESHOLD[level],
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: { level: (label: string) => ({ level: label }) },
        base: null,
        messageKey: 'msg',
        errorKey: 'err',
        serializers: { ...rest.serializers, err: serializeError },
      },
      makeDestination(format),
    ),
  );
}
