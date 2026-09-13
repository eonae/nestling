# @nestlingjs/logging

Интерфейс логгера Nestling и штатная реализация: четыре уровня, три формы
вызова у каждого, дочерний логгер с привязками и вывод в `stderr` текстом
или JSON. Зависимостей у пакета нет — он лежит в основании дерева, поэтому
сателлит логирования берёт отсюда интерфейс, не притаскивая ядро.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/container.md`](../../docs/design/container.md),
> раздел «Логгер ядра».
> Гайд: [глава 9. Видеть каждый запрос в логе](../../docs/guide/09-logging.md).

## Установка

```bash
npm install @nestlingjs/logging
```

## Минимальный пример

```typescript
import { makeConsoleLogger } from '@nestlingjs/logging';

const logger = makeConsoleLogger({ level: 'info', format: 'json' });

logger.info('document written', { file, paths: 12 });
logger.child({ scope: 'openapi' }).warn(new Error('schema skipped'));
```

Приложение этот пакет не ставит: `@nestlingjs/app` зависит от него и
реэкспортирует и типы, и фабрику. Ставят его те, кому нужен интерфейс без
ядра, — адаптер стороннего логгера и скрипт вне приложения.

## Экспорты

| Имя | Что это |
| --- | --- |
| `Logger` | интерфейс логгера: `debug`, `info`, `warn`, `error`, `child` |
| `LogMethod` | метод уровня: три формы вызова |
| `Fields` | поля записи; ключ `err` зарезервирован за ошибкой |
| `LogLevel` | уровень записи: `debug`, `info`, `warn`, `error` |
| `LogThreshold` | порог записи: уровень или `silent` |
| `LogFormat` | формат строки: `text` или `json` |
| `ConsoleLoggerOptions` | опции фабрики: `level` и `format` |
| `makeConsoleLogger` | штатный логгер; умолчания `info` и `text` |

Класс реализации наружу не идёт: логгер создаёт фабрика.

## Границы пакета

Пакет описывает, чем пишут, и пишет сам. DI-токены `RootLogger$` и
`Logger$`, секция конфига `nestlingLog` и декоратор полей корреляции живут
в `@nestlingjs/app`: им нужны контейнер, конфиг и ячейка запроса.
