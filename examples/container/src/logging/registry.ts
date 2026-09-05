import { makeTokenFamily } from '@nestling/container';

export interface Logger {
  log(...args: unknown[]): void;
}

/**
 * Семейство токенов логгера: `Logger('users')` — токен `Logger:users`.
 *
 * Рецепт на всё семейство поставляет плагин `appLogging`; контейнер
 * создаёт только те члены, которые кто-то запросил в `deps`.
 */
export const Logger = makeTokenFamily<Logger, [scope: string]>('Logger');
