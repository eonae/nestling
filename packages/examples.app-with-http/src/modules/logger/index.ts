/**
 * Поверхность инфра-модуля логирования.
 *
 * Наружу уезжает ровно четыре вещи: фабрика модуля, токен логгера, слой
 * наблюдаемости и `keys`-хэндл секции. Токен секции остаётся внутри —
 * инжектнуть её из соседней фичи нечем, а привязать источник (`config:` в
 * корне) можно.
 */

export { loggerConfigKeys } from './logger.config';
export { logging, type LoggingOptions } from './logger.module';
export { ILogger, type ILoggerService } from './logger.service';
export { observability } from './observability';
