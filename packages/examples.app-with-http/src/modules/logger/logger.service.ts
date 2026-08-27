/* eslint-disable no-console */

import { makeToken } from '@nestling/container';

/**
 * Интерфейс логгера
 */
export const ILogger = makeToken<ILoggerService>('ILogger');

export interface ILoggerService {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Уровни по возрастанию строгости: `debug` слышит всё, `error` — только ошибки */
export type LogLevel = 'debug' | 'info' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

/**
 * Простой логгер (singleton).
 *
 * Конструктор принимает обе стороны канона: имя сервиса — параметр
 * `logging({ … })`, то есть решение композиции, а уровень приезжает из
 * конфиг-секции модуля, то есть из среды. Класс поэтому не `@Injectable`:
 * его собирает фабрика модуля, которая и сводит два источника вместе.
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
