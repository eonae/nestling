import { makeTokenFamily } from '@nestling/container';

export interface ILogger {
  log(...args: unknown[]): void;
}

/**
 * Семейство токенов логгера: `ILogger('users')` — обычный мемоизированный токен
 * `Logger:users`. Рецепт на всё семейство везёт плагин `appLogging`;
 * билдер создаёт ровно те скоупы, которые кто-то запросил в deps.
 */
export const ILogger = makeTokenFamily<ILogger, [scope: string]>('Logger');
