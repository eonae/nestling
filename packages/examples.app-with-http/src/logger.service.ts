import { Injectable, makeToken } from '@nestling/container';

/**
 * Интерфейс логгера
 */
export const ILogger = makeToken<ILoggerService>('ILogger');

export interface ILoggerService {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Простой логгер (singleton)
 */
@Injectable(ILogger, [])
export class ConsoleLogger implements ILoggerService {
  log(...args: unknown[]): void {
    console.log('[LOG]', ...args);
  }

  error(...args: unknown[]): void {
    console.error('[ERROR]', ...args);
  }
}

