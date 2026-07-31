import { LoggerConfig } from './logger.config';
import { ConsoleLogger, ILogger } from './logger.service';
import { AuditOutcome } from './observability';

import type { Config } from '@nestling/config';
import type { Module } from '@nestling/container';
import { factoryProvider, makeModule } from '@nestling/container';

/**
 * Что решает **композиция**, а не среда: имя, которым инстанс называет себя
 * в записях. Адрес, уровень и прочее «меняется без пересборки» живёт в
 * секции модуля (`logger.config.ts`), а не здесь.
 */
export interface LoggingOptions {
  /** Имя сервиса в префиксе каждой записи */
  service: string;
}

/**
 * Параметризованная инфраструктура — просто функция, возвращающая модуль.
 *
 * Плагина как примитива в ядре нет: ни типа `Plugin`, ни поля `plugins:` в
 * корне, ни `DynamicModule`/`forRoot`. Инфраструктура — обычный модуль,
 * который приезжает в граф через `modules:` корня или модули своей фичи.
 *
 * Значение создаётся **один раз** (см. `src/infrastructure.ts`) и
 * разделяется импортом: повторный вызов даёт другое значение под тем же
 * именем, и сборка на этом падает — структурного сравнения опций нет и не
 * будет.
 *
 * @param options - Решения композиции; всё остальное приезжает из секции
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
      // Фабрика сводит обе стороны канона: параметр композиции и секцию среды
      factoryProvider(
        ILogger,
        (config: Config<typeof LoggerConfig>) =>
          new ConsoleLogger(options.service, config.level),
        [LoggerConfig],
      ),
      // Юнит слоя едет вместе с модулем: слой без своего логгера не соберётся
      AuditOutcome,
    ],
    exports: [ILogger],
  });
