/* eslint-disable no-console */

import { makeToken } from '@nestling/container';

/** Токен логгера */
export const ILogger = makeToken<ILoggerService>('ILogger');

export interface ILoggerService {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Уровни по возрастанию строгости: `debug` пишет всё, `error` — ошибки */
export type LogLevel = 'debug' | 'info' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

/**
 * Логгер в консоль.
 *
 * Имя сервиса приходит из параметра `logging({ … })`, уровень — из
 * конфиг-секции модуля. Класс не помечен `@Injectable`: его создаёт
 * фабрика модуля, которая соединяет оба источника.
 */
export class ConsoleLogger implements ILoggerService {
  constructor(
    private readonly service: string,
    private readonly level: LogLevel,
  ) {}

  debug(...args: unknown[]): void {
    this.write('debug', console.log, args);
  }

  log(...args: unknown[]): void {
    this.write('info', console.log, args);
  }

  error(...args: unknown[]): void {
    this.write('error', console.error, args);
  }

  private write(
    level: LogLevel,
    sink: (...args: unknown[]) => void,
    args: readonly unknown[],
  ): void {
    if (ORDER[level] < ORDER[this.level]) {
      return;
    }

    sink(`[${this.service}] [${level.toUpperCase()}]`, ...args);
  }
}
