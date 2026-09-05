/* eslint-disable no-console -- логгер примера пишет в stdout */
import { Injectable, makeToken } from '@nestling/container';

/** Логгер приложения */
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

/** Токен логгера: потребители зависят от интерфейса, а не от класса */
export const Logger$ = makeToken<Logger>('Logger');

/** Логгер в stdout с именем сервиса в префиксе */
@Injectable(Logger$, [])
export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(`[users-service] ${message}`);
  }

  error(message: string): void {
    console.error(`[users-service] ${message}`);
  }
}
