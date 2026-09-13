# logging-package Specification

## Purpose
TBD - created by archiving change logging-core. Update Purpose after archive.
## Requirements
### Requirement: Пакет `@nestlingjs/logging` — интерфейс и штатная реализация

Репозиторий SHALL содержать пакет `@nestlingjs/logging` в каталоге
`packages/nestling.logging`. Пакет SHALL экспортировать типы `Logger`,
`Fields`, `LogLevel` и `LogMethod` и фабрику `makeConsoleLogger(options)`.

Зависимостей у пакета SHALL NOT быть: ни `dependencies`, ни
`peerDependencies`. Он лежит в основании дерева, и сателлит логирования
SHALL зависеть только от него.

Класс реализации SHALL NOT экспортироваться: наружу идёт фабрика.
DI-токены `RootLogger$` и `Logger$`, секция `nestlingLog` и декоратор
полей SHALL оставаться в `@nestlingjs/app` — им нужны контейнер, конфиг и
ячейка запроса.

#### Scenario: Сателлит зависит от одного пакета

- **WHEN** пакет реализует `Logger` поверх сторонней библиотеки
- **THEN** в его `dependencies` есть `@nestlingjs/logging` и нет
  `@nestlingjs/app`

#### Scenario: Реализация приватна

- **WHEN** код пишет `import { ConsoleLogger } from '@nestlingjs/logging'`
- **THEN** импорт не компилируется: пакет отдаёт `makeConsoleLogger`

### Requirement: `makeConsoleLogger(options)` — логгер для кода вне приложения

`makeConsoleLogger(options?)` SHALL возвращать `Logger`, который пишет
каждую запись одной строкой в `process.stderr`. Опции SHALL быть
`{ level?, format? }` с умолчаниями `info` и `text`; значения `level` —
`debug`, `info`, `warn`, `error` и `silent`, значения `format` — `text` и
`json`.

Формат записи SHALL совпадать с форматом логгера приложения: в `text` —
`<время ISO> <УРОВЕНЬ> <scope> <сообщение> key=value …`, в `json` — объект
с полями `time`, `level`, привязками, `msg`, полями вызова и `err` в виде
`{ name, message, stack, cause? }`.

Поля корреляции `makeConsoleLogger` SHALL NOT ставить: их подмешивает
декоратор корня, а скрипт вне приложения запроса не обрабатывает.

#### Scenario: Скрипт пишет тем же форматом

- **WHEN** скрипт `openapi.ts` создаёт `makeConsoleLogger()` и вызывает
  `logger.info('document written', { path })`
- **THEN** в `stderr` уходит строка того же формата, что пишет приложение,
  а `stdout` остаётся свободным

#### Scenario: Уровень отсекает записи

- **WHEN** создан `makeConsoleLogger({ level: 'warn' })` и вызван
  `logger.info('x')`
- **THEN** в `stderr` ничего не пишется, а `logger.warn('y')` пишется

#### Scenario: Молчащий логгер

- **WHEN** создан `makeConsoleLogger({ level: 'silent' })`
- **THEN** ни один из четырёх уровней ничего не пишет

### Requirement: `@nestlingjs/app` реэкспортирует типы логгера

`@nestlingjs/app` SHALL зависеть от `@nestlingjs/logging` и реэкспортировать
`Logger`, `Fields`, `LogLevel` и `LogMethod` поимённым `export`.
Приложение, которое уже импортирует типы из `@nestlingjs/app`, SHALL
продолжать это делать.

Фабрику `makeConsoleLogger` `@nestlingjs/app` SHALL реэкспортировать тоже:
скрипт рядом с приложением берёт логгер, не добавляя второй пакет в
`dependencies`.

#### Scenario: Тип берётся из ядра

- **WHEN** сервис пишет `import type { Logger } from '@nestlingjs/app'`
- **THEN** он получает тот же тип, что экспортирует `@nestlingjs/logging`

#### Scenario: Барель без `export *`

- **WHEN** барель `@nestlingjs/app` отдаёт типы логгера
- **THEN** они перечислены поимённо в `export type { … } from '@nestlingjs/logging'`

