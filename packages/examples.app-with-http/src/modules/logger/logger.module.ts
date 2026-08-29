import { LoggerConfig } from './logger.config';
import { ConsoleLogger, ILogger } from './logger.service';
import { AuditOutcome } from './observability';

import type { Config } from '@nestling/config';
import type { Module } from '@nestling/container';
import { factoryProvider, makeModule } from '@nestling/container';

/**
 * Параметры модуля логирования: решения композиции.
 *
 * Здесь — имя сервиса в записях. Уровень и всё, что меняется без
 * пересборки, живёт в конфиг-секции (`logger.config.ts`).
 */
export interface LoggingOptions {
  /** Имя сервиса в префиксе каждой записи */
  service: string;
}

/**
 * Создаёт модуль логирования с заданными параметрами.
 *
 * Параметризованная инфраструктура — обычная функция, возвращающая
 * модуль. Отдельного примитива «плагин» нет: модуль подключается через
 * `modules:` корня или через `imports:` модулей фич.
 *
 * Вызывайте функцию один раз (см. `src/infrastructure.ts`) и импортируйте
 * значение: повторный вызов даёт другой модуль с тем же именем, и сборка
 * падает.
 *
 * @param options - Решения композиции; остальное берётся из секции
 *
 * @example
 * ```typescript
 * export const appLogging = logging({ service: 'app-with-http' });
 * ```
 */
export const logging = (options: LoggingOptions): Module =>
  makeModule({
    name: 'module:logging',
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
    exports: [ILogger],
  });
