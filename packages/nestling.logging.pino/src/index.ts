/**
 * `@nestlingjs/logging.pino` — pino под интерфейсом `Logger`.
 *
 * Пакет отдаёт одно значение: `pinoLogger(options)` возвращает `Logger`
 * поверх настоящего экземпляра pino. Его берёт поле `logging.logger`
 * корня и код вне приложения — скрипт, миграция, standalone-диспетчер.
 *
 * Формат `text` совпадает со штатным логгером: строку печатает общая
 * функция из `@nestlingjs/logging`. Формат `json` пишет сам pino — набор
 * ключей тот же, порядок его.
 *
 * Зависимость у пакета одна — `@nestlingjs/logging`; сам pino приходит
 * peer-зависимостью, его версию выбирает приложение.
 */

export type { PinoLoggerOptions } from './logger.js';
export { pinoLogger } from './logger.js';
