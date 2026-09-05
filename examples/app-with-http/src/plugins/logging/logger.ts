/* eslint-disable no-console -- логгер примера пишет в stdout */
import { makeToken } from '@nestling/container';

/** Логгер приложения */
export interface Logger {
  debug(message: string): void;
  log(message: string): void;
  error(message: string): void;
}

/** Токен логгера: потребители зависят от интерфейса, а не от класса */
export const Logger$ = makeToken<Logger>('Logger');

/** Уровни по возрастанию строгости */
export type LogLevel = 'debug' | 'info' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

/**
 * Логгер в stdout. Имя сервиса приходит из параметра плагина, уровень из
 * конфиг-секции; соединяет их фабрика в `logging.plugin.ts`.
 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly service: string,
    private readonly level: LogLevel,
  ) {}

  debug(message: string): void {
    this.write('debug', console.log, message);
  }

  log(message: string): void {
    this.write('info', console.log, message);
  }

  error(message: string): void {
    this.write('error', console.error, message);
  }

  private write(
    level: LogLevel,
    sink: (line: string) => void,
    message: string,
  ): void {
    if (ORDER[level] < ORDER[this.level]) {
      return;
    }

    sink(`[${this.service}] ${message}`);
  }
}
