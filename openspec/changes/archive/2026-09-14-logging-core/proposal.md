## Why

Шов замены логгера неполный. Опция `makeApp({ logger })` принимает любую
реализацию `Logger`, но поля корреляции ставит только `ConsoleLogger`:
он читает `ambientRequestId()` и `ambientTraceId()`, а эти функции из
пакета не экспортируются. Внешний логгер остаётся без `requestId` и
`traceId` и оказывается хуже штатного.

Интерфейс `Logger` живёт в `@nestlingjs/app`, и сателлит логирования
обязан зависеть от всего ядра ради четырёх типов. Скрипт вне приложения
логгер взять не может: единственная реализация приватна. Примеры пишут
через `console` в 36 местах, восемь файлов открыты
`eslint-disable no-console`.

Решение зафиксировано записью
[ideas.md [2026-09-13]](../../../docs/decisions/ideas.md) «Логгер: опция
`logging`, пакет `@nestlingjs/logging`, поля-декларации, pino сателлитом»;
строка 93 [roadmap.md](../../../docs/decisions/roadmap.md).

## What Changes

- **BREAKING** Опция корня `logger:` заменяется на
  `logging: { logger?, fields? }`. Поле `logger` — готовый логгер,
  умолчание прежнее. Поле `fields` — список переменных контекста, которые
  попадают в каждую запись; умолчание —
  `[RequestId, logField(Trace, 'traceId', (t) => t.traceId)]`.
- Корень оборачивает логгер декоратором корреляции: значения объявленных
  переменных подмешиваются на каждой записи. Любая реализация получает
  корреляцию, не зная внутренностей ядра. `ConsoleLogger` перестаёт читать
  ambient-контекст, `ambientRequestId` и `ambientTrace` остаются
  приватными.
- Новая декларация `logField(Var, name, select?)`: переименование поля и
  проекция значения. Переменная в списке без обёртки даёт поле с именем
  переменной и значением целиком.
- Поля объявляет и плагин: `makePlugin({ logFields: [Route] })`. Списки
  корня и плагинов собираются на ASSEMBLE. Два одинаковых имени — отказ
  сборки с именами объявивших.
- **BREAKING** Новый пакет `@nestlingjs/logging` без зависимостей: типы
  `Logger`, `Fields`, `LogLevel`, `LogMethod` и фабрика
  `makeConsoleLogger(options)`. `@nestlingjs/app` зависит от него и
  реэкспортирует типы; `Logger$` и `RootLogger$` остаются в `app` — им
  нужен контейнер.
- Секция `nestlingLog` принимает уровень `silent`: он отсекает все записи.
  `@nestlingjs/testing` поднимает приложение с ним по умолчанию, тест
  задаёт свой уровень через `config:`.
- Примеры пишут логгером. Скрипты вне приложения (`client.ts`,
  `openapi.ts`, `publish.ts`, `graph.ts`, `compat.ts`) берут
  `makeConsoleLogger()`. Вывод команд `cli` остаётся результатом команды
  на `stdout`.

## Capabilities

### New Capabilities

- `logging-package`: пакет `@nestlingjs/logging` — интерфейс логгера,
  фабрика `makeConsoleLogger`, границы пакета и его место в дереве
  зависимостей.
- `log-correlation-fields`: декоратор корреляции, опция `logging.fields`,
  поле `logFields` плагина, декларация `logField` и проверка имён на
  сборке.

### Modified Capabilities

- `kernel-logger`: опция корня `logging` вместо `logger`; интерфейс
  переезжает в `@nestlingjs/logging`; `ConsoleLogger` перестаёт читать
  ambient-контекст; уровень `silent` в секции `nestlingLog`.
- `test-composition-root`: тестовый прогон тихий по умолчанию.
- `example-apps`: примеры пишут логгером, `console` остаётся только
  выводом команды CLI.

## Impact

- `packages/nestling.app`: `src/logger/*` (интерфейс переносится, корень
  оборачивается декоратором), `src/root/plan.ts` и `src/root/app.ts`
  (опция, сбор полей, проверка имён), `src/root/feature.ts` (`logFields` у
  плагина), `src/pipeline/core/context/reader.ts` (ambient-читалки
  остаются внутренними).
- Новый `packages/nestling.logging`: манифест, `LICENSE`, README на двух
  языках, барель поимённым экспортом.
- `packages/nestling.testing`: умолчание уровня, README.
- `examples/*`: `console` уходит из пяти скриптов и трёх файлов
  приложений.
- Документация: `docs/guide/09-logging.md` и английская пара,
  `docs/design/container.md` (раздел «Логгер ядра»), `docs/glossary.md`,
  README пакетов `app`, `testing` и нового `logging`.

## Non-goals

- Сателлит `@nestlingjs/logging.pino` — строка 94 roadmap, следующий
  change.
- Метрики и трассы в OpenTelemetry — строка 85.
- Переменная `Caller` и слой аутентификации — строка 78.
- Судьба `withRequestLogging` — строка 81, идёт параллельно.
- Переименования `assemble` → `build` и `Unit` → `Step` — строка 86.
