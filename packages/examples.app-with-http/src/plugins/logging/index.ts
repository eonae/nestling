/**
 * Плагин логирования: фабрика плагина, токен логгера, слой наблюдаемости и
 * ключи конфиг-секции. Токен секции остаётся внутри плагина.
 */

export { type Logger, Logger$ } from './logger.js';
export { loggerConfigKeys } from './logger.config.js';
export { logging, type LoggingOptions } from './logging.plugin.js';
export { observability } from './observability.js';
