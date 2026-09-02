/**
 * Публичная поверхность модуля логирования.
 *
 * Экспортируются четыре вещи: фабрика модуля, токен логгера, слой
 * наблюдаемости и `.keys` конфиг-секции. Токен секции остаётся внутри:
 * инжектировать её из другой фичи нельзя, а привязать источник через
 * `config:` в корне — можно.
 */

export { loggerConfigKeys } from './logger.config';
export { logging, type LoggingOptions } from './logger.plugin';
export { ILogger, type ILoggerService } from './logger.service';
export { observability } from './observability';
