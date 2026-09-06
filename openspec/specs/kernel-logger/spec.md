# kernel-logger

## Purpose

Логгер ядра — единственный канал вывода Nestling. `@nestling/app`
экспортирует интерфейс `Logger`, корневой DI-токен `RootLogger$` и семейство
`Logger$` с параметром `scope`; ядро пишет только через члены семейства и не
обращается к `console`. Умолчание — `ConsoleLogger`, настраиваемый
kernel-секцией `nestlingLog` и подменяемый одним провайдером под
`RootLogger$`. Тест перехватывает записи подменой корня на `spyLogger()`.

## Requirements

### Requirement: Интерфейс `Logger` — четыре уровня, три формы вызова, `child`

`@nestling/app` SHALL экспортировать интерфейс `Logger` с методами
`debug`, `info`, `warn`, `error` и `child(bindings)`, а также типы
`Fields = Record<string, unknown> & { err?: unknown }` и
`LogLevel = 'debug' | 'info' | 'warn' | 'error'`. Каждый метод уровня SHALL
принимать три формы: `(message, fields?)`, `(error, fields?)` и
`(fields)`. Форма с `Error` первым аргументом SHALL брать сообщение из
`error.message` и класть саму ошибку в `err`. Ключ `err` SHALL быть
зарезервирован за ошибкой. `child(bindings)` SHALL возвращать логгер,
который добавляет `bindings` к каждой записи; привязки дочернего логгера
SHALL накладываться поверх родительских, поля вызова — поверх привязок.

#### Scenario: Сообщение с полями

- **WHEN** вызвано `logger.info('database connected', { host: 'db' })`
- **THEN** запись несёт уровень `info`, сообщение `database connected` и
  поле `host`

#### Scenario: Ошибка первым аргументом

- **WHEN** вызвано `logger.error(new Error('boom'), { operation: 'x' })`
- **THEN** запись несёт сообщение `boom`, поле `operation` и ошибку в
  `err`

#### Scenario: Отказ проходит формой ошибки

- **WHEN** вызвано `logger.warn(UserNotFound({ id: '1' }))`
- **THEN** вызов компилируется, а запись несёт отказ в `err`

#### Scenario: Только поля

- **WHEN** вызвано `logger.debug({ rows: 3 })`
- **THEN** запись несёт поле `rows` и не несёт сообщения

#### Scenario: Привязки дочернего логгера

- **WHEN** `const child = logger.child({ scope: 'users' })` и вызвано
  `child.info('ok', { scope: 'override', n: 1 })`
- **THEN** запись несёт `scope: 'override'` и `n: 1`

### Requirement: `RootLogger$` и семейство `Logger$`

`@nestling/app` SHALL экспортировать DI-токен `RootLogger$` типа `Logger`
и семейство DI-токенов `Logger$` с параметром `scope`. Kernel-модуль
логгера SHALL регистрировать рецепт семейства
`root.child({ scope })` от `RootLogger$` и член `Logger$('nestling')`
явным провайдером. `Logger$.auto` SHALL давать член по имени
класса-потребителя. Замена провайдера под `RootLogger$` SHALL менять все
члены семейства; потребители членов SHALL NOT видеть замены.

#### Scenario: Член семейства — дочерний логгер корня

- **WHEN** класс объявляет `@Injectable([Logger$('users')])`, и
  приложение собрано
- **THEN** он получает логгер, каждая запись которого несёт привязку
  `scope: 'users'`

#### Scenario: `.auto` даёт член по имени класса

- **WHEN** класс `UsersRepository` объявляет `@Injectable([Logger$.auto])`
- **THEN** он получает член `Logger$('UsersRepository')`

#### Scenario: Замена корня меняет все члены

- **WHEN** плагин регистрирует `factoryProvider(RootLogger$, () => custom, [])`,
  а сервис зависит от `Logger$('users')`
- **THEN** сервис пишет через `custom.child({ scope: 'users' })`, и
  сборка проходит без ошибки дубля

### Requirement: Умолчание модуля попадает в граф только без соперника

`Module` SHALL принимать поле `defaults?: Provider[]`. Провайдер из
`defaults` SHALL попадать в граф, только если к моменту `build()` под его
DI-токеном не зарегистрирован ни один провайдер — ни модулем, ни
фабрикой провайдеров модуля, ни `register()`, в любом порядке
регистрации. Узел SHALL атрибутироваться модулю, объявившему умолчание.
Умолчание SHALL применяться в `build()` после раскрытия фабрик
провайдеров модулей и до подстановок и создания членов семейств. Два
умолчания под одним DI-токеном SHALL быть ошибкой регистрации.

#### Scenario: Без соперника умолчание в графе

- **WHEN** зарегистрирован модуль с `defaults: [classProvider(RootLogger$, ConsoleLogger)]`
  и ни один провайдер под `RootLogger$` больше не зарегистрирован
- **THEN** после `build()` `container.get(RootLogger$)` — экземпляр
  `ConsoleLogger`, узел атрибутирован модулю

#### Scenario: Провайдер модуля побеждает умолчание

- **WHEN** тот же модуль зарегистрирован раньше модуля с
  `providers: [factoryProvider(RootLogger$, () => custom, [])]`
- **THEN** `build()` проходит без ошибки дубля, а
  `container.get(RootLogger$)` возвращает `custom`

#### Scenario: Провайдер из фабрики модуля побеждает умолчание

- **WHEN** соперник приходит из `providers: () => [factoryProvider(RootLogger$, …)]`
- **THEN** умолчание в граф не попадает

#### Scenario: Подстановка находит умолчание

- **WHEN** тестовый корень передаёт `overrides: [[RootLogger$, spy]]`, а
  провайдер под `RootLogger$` есть только в `defaults`
- **THEN** подстановка применяется, ошибки «нечего подменять» нет

#### Scenario: Два умолчания под одним DI-токеном

- **WHEN** два модуля объявляют умолчание под `RootLogger$`
- **THEN** регистрация второго падает с именами обоих модулей

### Requirement: `ConsoleLogger` — умолчание ядра с секцией `nestlingLog`

Kernel-модуль логгера SHALL регистрироваться сборкой всегда и объявлять
`ConsoleLogger` умолчанием под `RootLogger$`. `ConsoleLogger` SHALL читать
уровень и формат из kernel-секции `nestlingLog`: `NESTLING_LOG_LEVEL`
(`debug` | `info` | `warn` | `error`, по умолчанию `info`) и
`NESTLING_LOG_FORMAT` (`text` | `json`, по умолчанию `text`). Запись
уровня ниже заданного SHALL отбрасываться. Записи SHALL уходить в
`process.stderr` одной строкой каждая. В формате `json` строка SHALL быть
объектом с полями `time`, `level`, `msg`, привязками, полями вызова и
`err` в виде `{ name, message, stack, cause? }`. `requestId` SHALL
читаться из `Ctx(RequestId)` в момент записи и добавляться полем, если
он есть и поле не задано вызовом. Класс `ConsoleLogger` и DI-токен секции
SHALL NOT экспортироваться; наружу SHALL идти только `logConfigKeys`.
Секция SHALL NOT быть reloadable.

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

#### Scenario: Вне запроса поля нет

- **WHEN** `logger.info('started')` вызван из `@OnStart`
- **THEN** поля `requestId` в записи нет

#### Scenario: Невалидный уровень падает на сборке

- **WHEN** задано `NESTLING_LOG_LEVEL=loud`
- **THEN** старт падает валидацией секции с перечнем допустимых значений

### Requirement: Ядро пишет только через логгер

Ядро SHALL писать только через `Logger$('nestling')` и члены
`Logger$('nestling:<область>')`; вне `ConsoleLogger` ядро SHALL NOT
обращаться к `console` и потокам процесса. Состав сборки на старте,
замыкание выбора, detached-endpoint'ы, скрытые endpoint'ы OpenAPI и
сигнал остановки SHALL писаться уровнем `info`; недолговечные операции,
простаивающий интерком, предупреждения конфига и предупреждения
контейнера — уровнем `warn`; незадекларированные отказы, отказы портов и
отказы доставки шины и NATS — уровнем `error` с оригиналом в `err`.
Предупреждения читалки конфига SHALL копиться до подключения логгера и
уходить в него сразу после `build()`; после подключения SHALL писаться
напрямую. Хуков вывода `onUnknownFail`, `onDeliveryFailure`,
`onPortFailure` и `onWarn` SHALL NOT существовать.

#### Scenario: Состав сборки — запись логгера

- **WHEN** приложение с подменой `[RootLogger$, spy.logger]` выходит в
  эфир
- **THEN** среди записей есть `info` с сообщением о составе и полями
  `features` и `transports`, а `console.log` не вызывался

#### Scenario: Предупреждение конфига доходит до подмены

- **WHEN** корень привязывает глоб `'*_UR'` при объявленных ключах
  `*_URL`, а `RootLogger$` подменён `spyLogger()`
- **THEN** среди записей есть `warn` с текстом о таргете и источнике

#### Scenario: Незадекларированный отказ — запись `error`

- **WHEN** хендлер endpoint'а без `errors:` возвращает
  `Fail.notFound('nope')`, а `RootLogger$` подменён `spyLogger()`
- **THEN** клиент получает `internal_error`, а среди записей есть `error`
  с полями `transport`, `pattern`, `code` и оригиналом в `err`

#### Scenario: Предупреждение reloadable-секции после подключения

- **WHEN** источник с наблюдением отдал невалидное значение
  reloadable-секции на фазе RUN
- **THEN** запись `warn` уходит в логгер напрямую, а не копится

#### Scenario: Остановка по сигналу

- **WHEN** процессу отправлен `SIGTERM`
- **THEN** запись `info` с полем `signal: 'SIGTERM'` уходит в логгер, а
  `console.log` не вызывался

### Requirement: Standalone-пути используют умолчание ядра

`makeDispatch(endpoints, options?)` SHALL принимать `{ logger?: Logger }`
и без него использовать `ConsoleLogger` с уровнем `info` и форматом
`text`. `new InProcessBus(options?)` SHALL принимать `{ buffer?, logger? }`
с тем же умолчанием. `ExecuteOptions` рантайма пайплайна SHALL нести
`logger?` вместо `onUnknownFail`, а тип `UnknownFailInfo` SHALL NOT
существовать.

#### Scenario: `serve` без `App` не проглатывает отказ

- **WHEN** `makeDispatch([Ping])` собран без логгера, и хендлер бросает
  незадекларированный отказ
- **THEN** в `stderr` уходит запись `error` с паттерном и оригиналом

#### Scenario: Логгер передан явно

- **WHEN** `makeDispatch([Ping], { logger: spy.logger })`
- **THEN** запись о незадекларированном отказе попадает в `spy.entries`

### Requirement: `withRequestLogging` принимает `Logger` ядра

`withRequestLogging(logger)` SHALL принимать `Logger` из `@nestling/app`
и писать `info` с сообщением о начале обработки и полями `transport` и
`pattern`. Локального интерфейса `Logger` у юнита SHALL NOT существовать.

#### Scenario: Запись о начале обработки

- **WHEN** пайплайн с `.pre(withRequestLogging(spy.logger))` исполняет
  `GET /users`
- **THEN** в `spy.entries` есть `info` с `transport: 'http'` и
  `pattern: 'GET /users'`

### Requirement: `spyLogger()` — записи значениями

`@nestling/testing` SHALL экспортировать `spyLogger()`, возвращающий
`{ logger, entries }`, где `entries` — список записей
`{ level, message, fields }`. `child(bindings)` такого логгера SHALL
писать в тот же список, объединяя привязки с полями записи. Подмена
`[RootLogger$, spy.logger]` в `overrides` SHALL перехватывать записи всех
членов `Logger$`.

#### Scenario: Записи сервиса через подмену корня

- **WHEN** `assembleTest(app, { overrides: [[RootLogger$, spy.logger]] })`,
  и сервис с `Logger$.auto` пишет `info('byId', { id: '1' })`
- **THEN** `spy.entries` содержит запись с `level: 'info'`,
  `message: 'byId'` и полями `id` и `scope`

#### Scenario: Дочерний логгер пишет в тот же список

- **WHEN** вызвано `spy.logger.child({ a: 1 }).warn('x', { b: 2 })`
- **THEN** `spy.entries` содержит запись с полями `a` и `b`
