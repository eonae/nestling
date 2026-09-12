## MODIFIED Requirements

### Requirement: `ConsoleLogger` — умолчание ядра с секцией `nestlingLog`

`ConsoleLogger` SHALL быть умолчанием корневого логгера: сборка создаёт
его, если опция `logger` не передана. Создание SHALL происходить на фазе 0
от снимка kernel-секции `nestlingLog`, без контейнера: корень нужен
раньше, чем существует хоть один узел.

`ConsoleLogger` SHALL читать уровень и формат из секции `nestlingLog`:
`NESTLING_LOG_LEVEL` (`debug` | `info` | `warn` | `error`, по умолчанию
`info`) и `NESTLING_LOG_FORMAT` (`text` | `json`, по умолчанию `text`).
Запись уровня ниже заданного SHALL отбрасываться. Записи SHALL уходить в
`process.stderr` одной строкой каждая. В формате `json` строка SHALL быть
объектом с полями `time`, `level`, `msg`, привязками, полями вызова и
`err` в виде `{ name, message, stack, cause? }`. `requestId` и `traceId` SHALL
читаться из ambient-контекста запроса в момент записи и добавляться полями,
если они есть и поля не заданы вызовом; зависимости от узлов
`Ctx(RequestId)` и `Ctx(Trace)` у корневого логгера SHALL NOT быть — он
существует раньше графа. `traceId` SHALL браться из переменной `Trace`
(capability `trace-context`), которую кладёт `withTracing()`. Класс
`ConsoleLogger` и DI-токен секции SHALL NOT экспортироваться; наружу SHALL
идти только `logConfigKeys`. Секция SHALL NOT быть reloadable.

#### Scenario: Уровень отсекает записи

- **WHEN** задано `NESTLING_LOG_LEVEL=warn` и вызвано `logger.info('x')`
- **THEN** в `stderr` ничего не пишется, а `logger.warn('y')` пишется

#### Scenario: Формат JSON

- **WHEN** задано `NESTLING_LOG_FORMAT=json` и вызвано
  `Logger$('users')`-логгером `info('ok', { n: 1 })`
- **THEN** строка разбирается как JSON с `level: 'info'`, `scope: 'users'`,
  `msg: 'ok'`, `n: 1` и `time`

#### Scenario: Ошибка сериализуется полями

- **WHEN** в формате `json` вызвано `logger.error(new Error('boom'))`
- **THEN** объект несёт `msg: 'boom'` и `err` с `name`, `message` и
  `stack`

#### Scenario: Идентификатор запроса внутри запроса

- **WHEN** запрос проходит через слой с `withRequestId()`, а сервис в
  глубине графа вызывает `logger.info('select')`
- **THEN** запись несёт поле `requestId` с идентификатором этого
  запроса

#### Scenario: Идентификатор трассы внутри запроса

- **WHEN** запрос проходит через слой с `withTracing()`, а сервис в
  глубине графа вызывает `logger.info('select')`
- **THEN** запись несёт поле `traceId` с идентификатором этой трассы

#### Scenario: Два процесса сходятся по идентификатору трассы

- **WHEN** запрос обработан сервисом A и продолжен вызовом порта в
  процессе B
- **THEN** записи обоих процессов несут одно и то же значение `traceId`

#### Scenario: Вне запроса полей нет

- **WHEN** `logger.info('started')` вызван из `@OnStart`
- **THEN** полей `requestId` и `traceId` в записи нет

#### Scenario: Записи сборки идут в тот же логгер

- **WHEN** приложение собирается с одноимёнными узлами графа, из-за чего
  контейнер даёт предупреждение
- **THEN** предупреждение уходит в тот же корневой логгер, что и записи
  фазы RUN, — с тем же уровнем и форматом

#### Scenario: Невалидный уровень падает на сборке

- **WHEN** задано `NESTLING_LOG_LEVEL=loud`
- **THEN** старт падает валидацией секции с перечнем допустимых значений

