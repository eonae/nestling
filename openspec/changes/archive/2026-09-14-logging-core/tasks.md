## 1. Пакет `@nestlingjs/logging`

- [x] 1.1 Завести `packages/nestling.logging` общим набором конфигов:
  `package.json` (без зависимостей, `exports`, `files`, `publishConfig`),
  `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`,
  `jest.config.js`, `LICENSE`
- [x] 1.2 Перенести `packages/nestling.app/src/logger/interface.ts` в
  `packages/nestling.logging/src/interface.ts` без правок типов
- [x] 1.3 Перенести `console.ts` и `console.spec.ts`; класс `ConsoleLogger`
  остаётся приватным, наружу идёт `makeConsoleLogger({ level?, format? })`
  с умолчаниями `info` и `text`
- [x] 1.4 Добавить уровень `silent`: порог отсекает все четыре уровня, тип
  `LogLevel` остаётся четырьмя значениями
- [x] 1.5 Барель `src/index.ts` поимённым `export`; проверить
  `scripts/boundary/public-api-validator.mjs` и `yarn pack:check`
- [x] 1.6 `@nestlingjs/app`: зависимость на пакет, поимённый реэкспорт
  `Logger`, `Fields`, `LogLevel`, `LogMethod` и `makeConsoleLogger`
- [x] 1.7 `defaultLogger` standalone-путей (`makeDispatch`, `InProcessBus`)
  переводится на `makeConsoleLogger()`
- [x] 1.8 Секция `nestlingLog`: значение `silent` в перечне уровней,
  `LogConfig.level` принимает порог

## 2. Поля корреляции

- [x] 2.1 `pipeline/core/context/reader.ts`: внутренняя `ambientValue(key)`
  вместо `ambientRequestId` и `ambientTrace`; `ambientTraceId` удаляется
- [x] 2.2 `logField(variable, name, select?)` и тип объявления поля;
  экспорт из `@nestlingjs/app`
- [x] 2.3 Декоратор `withLogFields(logger, plan)`: подмешивает поля на
  каждой записи, `child` возвращает декорированного потомка, поле вызова
  сильнее поля корреляции
- [x] 2.4 Рантайм-тесты декоратора: поле внутри запроса, отсутствие полей
  вне запроса, приоритет поля вызова, проекция, дочерний логгер

## 3. Опция корня и поля плагина

- [x] 3.1 `AppSpecCommon`: поле `logging: { logger?, fields? }`; `logger`
  удаляется из типа, `APP_SPEC_FIELDS` и `NormalizedAppSpec`
- [x] 3.2 `App.#bootstrap`: корень создаётся из `logging.logger` или
  `makeConsoleLogger` и оборачивается декоратором; умолчание списка полей —
  `[RequestId, logField(Trace, 'traceId', (t) => t.traceId)]`
- [x] 3.3 `PluginOptions` и `Plugin`: поле `logFields`; `makePlugin`
  проверяет форму списка
- [x] 3.4 Сбор полей на ASSEMBLE после раскрытия веток переключателей:
  корень плюс подключённые плагины
- [x] 3.5 Дубль имени поля — отказ сборки с именем поля и обоими
  объявившими; тест на пару «корень и плагин» и на пару плагинов
- [x] 3.6 Сообщение ошибки дубля провайдера под `RootLogger$` называет
  опцию `logging`
- [x] 3.7 Рантайм-тесты корня: внешний логгер получает `requestId`, поле
  плагина попадает в записи, `fields: []` отключает корреляцию

## 4. Тестовый прогон

- [x] 4.1 `assembleTest` добавляет источник с `NESTLING_LOG_LEVEL=silent`
  низшим приоритетом
- [x] 4.2 Тесты: прогон молчит, уровень из `config:` возвращает записи,
  подмена `[RootLogger$, spy.logger]` видит записи запроса

## 5. Примеры

- [x] 5.1 `examples/microservice`: `client.ts` и `openapi.ts` переходят на
  `makeConsoleLogger()`, код приложения — на `Logger$`
- [x] 5.2 `examples/modular-app`: `publish.ts`, `graph.ts`, `compat.ts` и
  `operations.compat.spec.ts` — тем же способом
- [x] 5.3 `examples/cli`: `main.ts` и `help.command.ts` оставляют на
  `stdout` только результат команды, остальное пишут логгером
- [x] 5.4 Ни одного `eslint-disable no-console` в `examples/`

## 6. Замер горячего пути

- [x] 6.1 `yarn bench:http` под Node 24 до и после change'а; порог —
  отсутствие регрессии на `GET` и `POST`, число в отчёте задачи

## 7. Документация

- [x] 7.1 `docs/guide/09-logging.md` и `docs/en/guide/09-logging.md`: опция
  `logging`, поля корреляции, `logField`, `logFields` плагина; плашка
  «сверено с кодом» с новой датой и коммитом
- [x] 7.2 `docs/design/container.md` и английская пара, раздел «Логгер
  ядра»: декоратор, границы пакета `@nestlingjs/logging`
- [x] 7.3 README пакетов: новый `packages/nestling.logging/README.md` и
  `README.ru.md`, обновлённые README `nestling.app` и `nestling.testing`,
  плашки статуса
- [x] 7.4 `docs/README.md`: строка нового пакета в разделе «Пакеты»
- [x] 7.5 `docs/glossary.md` и `docs/en/glossary.md`: термин «поле
  корреляции», если он не определён в главе
- [x] 7.6 Скилл агента (`packages/nestling.agent-skill`): опция `logging`
  в справочниках и сниппетах, `yarn test` пакета зелёный
- [x] 7.7 `node .claude/skills/docs-style/scripts/lint.mjs` на все
  изменённые тексты — 0 запрещённых слов

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 8.5 Запись `ideas.md` [2026-09-13] «Логгер: опция `logging`, пакет
  `@nestlingjs/logging`, поля-декларации, pino сателлитом» несёт пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало в строку 94 и чем
  реализация уточнила решение
- [x] 8.6 `yarn docs:audit` — 0 ERROR
- [x] 8.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 8.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
