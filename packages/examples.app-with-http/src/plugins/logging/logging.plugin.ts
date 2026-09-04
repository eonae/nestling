import { LoggerConfig } from './logger.config.js';
import { ConsoleLogger, Logger$ } from './logger.js';
import { AuditOutcome } from './observability.js';

import type { Plugin } from '@nestling/app';
import { makePlugin } from '@nestling/app';
import type { Config } from '@nestling/config';
import { factoryProvider } from '@nestling/container';

/** Параметры плагина: то, что задаёт состав графа */
export interface LoggingOptions {
  /** Имя сервиса в префиксе каждой записи */
  service: string;
}

/**
 * Создаёт плагин логирования.
 *
 * Плагин — сквозная инфраструктура: он есть в каждом процессе, и фичи
 * обращаются к нему токеном `Logger$`. Значение создаётся один раз в
 * `root.ts`: повторный вызов даёт второй плагин с тем же именем, и сборка
 * останавливается.
 *
 * @param options - Параметры плагина
 */
export const logging = (options: LoggingOptions): Plugin =>
  makePlugin({
    name: 'app-logging',
    providers: [
      // Фабрика соединяет параметр плагина и значение из секции
      factoryProvider(
        Logger$,
        (config: Config<typeof LoggerConfig>) =>
          new ConsoleLogger(options.service, config.level),
        [LoggerConfig],
      ),
      // Класс-юнит слоя `observability`: без регистрации слой не соберётся
      AuditOutcome,
    ],
  });
