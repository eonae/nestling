import { LoggerConfig } from './logger.config';
import { ConsoleLogger, ILogger } from './logger.service';
import { AuditOutcome } from './observability';

import { makePlugin } from '@nestling/app';
import type { Plugin } from '@nestling/app';
import type { Config } from '@nestling/config';
import { factoryProvider } from '@nestling/container';

/**
 * Параметры плагина логирования: решения композиции.
 *
 * Здесь — имя сервиса в записях. Уровень и всё, что меняется без
 * пересборки, живёт в конфиг-секции (`logger.config.ts`).
 */
export interface LoggingOptions {
  /** Имя сервиса в префиксе каждой записи */
  service: string;
}

/**
 * Создаёт плагин логирования с заданными параметрами.
 *
 * Параметризованная инфраструктура — обычная функция, возвращающая
 * значение. Роль плагина новых механизмов не приносит: он перечисляется в
 * `plugins:` корня и доступен всем токеном.
 *
 * Вызывайте функцию один раз (см. `src/infrastructure.ts`) и импортируйте
 * значение: повторный вызов даёт другой плагин с тем же именем, и сборка
 * падает.
 *
 * @param options - Решения композиции; остальное берётся из секции
 *
 * @example
 * ```typescript
 * export const appLogging = logging({ service: 'app-with-http' });
 * ```
 */
export const logging = (options: LoggingOptions): Plugin =>
  makePlugin({
    name: 'app-logging',
    providers: [
      // Фабрика соединяет параметр модуля и значение из конфиг-секции
      factoryProvider(
        ILogger,
        (config: Config<typeof LoggerConfig>) =>
          new ConsoleLogger(options.service, config.level),
        [LoggerConfig],
      ),
      // Юнит слоя наблюдаемости: без него слой не соберётся
      AuditOutcome,
    ],
  });
