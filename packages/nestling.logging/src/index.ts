/**
 * `@nestlingjs/logging` — интерфейс логгера, штатная реализация и формат
 * записи.
 *
 * Пакет лежит в основании дерева зависимостей и не зависит ни от чего:
 * сателлит логирования берёт отсюда интерфейс, не притаскивая ядро. Класс
 * реализации наружу не идёт — её создаёт `makeConsoleLogger`.
 *
 * Формат записи наружу идёт: `formatLine` и `serializeError` печатают
 * строку, и сателлит печатает ими же. Иначе у формата было бы две
 * реализации, которые расходятся молча.
 *
 * DI-токены `RootLogger$` и `Logger$`, секция `nestlingLog` и декоратор
 * полей корреляции живут в `@nestlingjs/app`: им нужны контейнер, конфиг и
 * ячейка запроса.
 */

export type { ConsoleLoggerOptions, LogThreshold } from './console.js';
export { makeConsoleLogger } from './console.js';
export type { LogEntry, LogFormat } from './format.js';
export { formatLine, serializeError } from './format.js';
export type { Fields, Logger, LogLevel, LogMethod } from './interface.js';
