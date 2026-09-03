/**
 * Плагин логирования: фабрика плагина, токен логгера, слой наблюдаемости и
 * ключи конфиг-секции. Токен секции остаётся внутри плагина.
 */

export { type Logger, Logger$ } from './logger';
export { loggerConfigKeys } from './logger.config';
export { logging, type LoggingOptions } from './logging.plugin';
export { observability } from './observability';
