/**
 * `@nestlingjs/logging` — интерфейс логгера и штатная реализация.
 *
 * Пакет лежит в основании дерева зависимостей и не зависит ни от чего:
 * сателлит логирования берёт отсюда интерфейс, не притаскивая ядро. Класс
 * реализации наружу не идёт — её создаёт `makeConsoleLogger`.
 *
 * DI-токены `RootLogger$` и `Logger$`, секция `nestlingLog` и декоратор
 * полей корреляции живут в `@nestlingjs/app`: им нужны контейнер, конфиг и
 * ячейка запроса.
 */

export type {
  ConsoleLoggerOptions,
  LogFormat,
  LogThreshold,
} from './console.js';
export { makeConsoleLogger } from './console.js';
export type { Fields, Logger, LogLevel, LogMethod } from './interface.js';
