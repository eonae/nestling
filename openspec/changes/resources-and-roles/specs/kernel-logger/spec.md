## MODIFIED Requirements

### Requirement: `RootLogger$` и семейство `Logger$`

`@nestling/app` SHALL экспортировать DI-токен `RootLogger$` типа `Logger`
и семейство DI-токенов `Logger$` с параметром `scope`.

Корневой логгер SHALL создаваться **вне графа**, до построения контейнера:
либо это значение из опции `logger` корня, либо `ConsoleLogger` ядра.
Сборка SHALL регистрировать его провайдером значения под `RootLogger$`,
поэтому корень доступен и ядру на фазах 0–1, и узлам графа с фазы INIT —
это один и тот же объект.

Kernel-модуль логгера SHALL регистрировать рецепт семейства
`root.child({ scope })` от `RootLogger$` и члены `Logger$('nestling')` и
`Logger$('nestling:config')` явными провайдерами. Члены семейства SHALL
оставаться узлами графа. `Logger$.auto` SHALL давать член по имени
класса-потребителя.

Провайдер приложения под `RootLogger$` SHALL быть ошибкой дубля: корневой
логгер задаётся опцией корня, и второго способа его объявить SHALL NOT
существовать. Подмена `[RootLogger$, …]` в `overrides` тестового корня
SHALL продолжать работать: она заменяет корень членов семейства с фазы
INIT.

#### Scenario: Член семейства — дочерний логгер корня

- **WHEN** класс объявляет `@Component([Logger$('users')])`, и приложение
  собрано
- **THEN** он получает логгер, каждая запись которого несёт привязку
  `scope: 'users'`

#### Scenario: `.auto` даёт член по имени класса

- **WHEN** класс `UsersRepository` объявляет `@Component([Logger$.auto])`
- **THEN** он получает член `Logger$('UsersRepository')`

#### Scenario: Логгер из опции корня меняет все члены

- **WHEN** написано `makeApp({ …, logger: pinoAdapter })`, а сервис
  зависит от `Logger$('users')`
- **THEN** сервис пишет через `pinoAdapter.child({ scope: 'users' })`, а
  записи фаз 0 и 1 уходят в тот же `pinoAdapter`

#### Scenario: Провайдер под корнем не принимается

- **WHEN** модуль объявляет `providers: [factoryProvider(RootLogger$, () => custom, [])]`
- **THEN** сборка падает ошибкой дубля, называющей опцию `logger` как
  единственный способ задать корневой логгер

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
`err` в виде `{ name, message, stack, cause? }`. `requestId` SHALL
читаться из ambient-контекста запроса в момент записи и добавляться полем,
если он есть и поле не задано вызовом; зависимости от узла `Ctx(RequestId)`
у корневого логгера SHALL NOT быть — он существует раньше графа. Класс
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

#### Scenario: Вне запроса поля нет

- **WHEN** `logger.info('started')` вызван из `@OnStart`
- **THEN** поля `requestId` в записи нет

#### Scenario: Записи сборки идут в тот же логгер

- **WHEN** приложение собирается с одноимёнными узлами графа, из-за чего
  контейнер даёт предупреждение
- **THEN** предупреждение уходит в тот же корневой логгер, что и записи
  фазы RUN, — с тем же уровнем и форматом

#### Scenario: Невалидный уровень падает на сборке

- **WHEN** задано `NESTLING_LOG_LEVEL=loud`
- **THEN** старт падает валидацией секции с перечнем допустимых значений

## REMOVED Requirements

### Requirement: Умолчание модуля попадает в граф только без соперника

**Reason**: Поле `defaults` у `Module` вводилось ради одного потребителя —
`classProvider(RootLogger$, ConsoleLogger)`. Корневой логгер теперь
создаётся вне графа и регистрируется провайдером значения, а задаётся
опцией корня; умолчаний, уступающих провайдеру под тем же DI-токеном, в
ядре не остаётся.

**Migration**: Поле `defaults` у `Module` удаляется вместе с веткой его
разрешения в `build()`. Модуль, объявлявший умолчание, объявляет обычный
провайдер в `providers:`; конфликт двух провайдеров под одним DI-токеном
остаётся ошибкой сборки, как и прежде.
