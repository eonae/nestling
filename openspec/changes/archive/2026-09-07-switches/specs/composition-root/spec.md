## MODIFIED Requirements

### Requirement: `makeApp` — единственный публичный composition root

`@nestling/app` SHALL экспортировать функцию `makeApp(spec): App` —
единственный публичный composition root. Приложение уровня L0 (endpoint'ы
и транспорт) SHALL NOT упоминать ни фич, ни выбора, ни конфиг-привязок, ни
инвариантов.

Состав приложения SHALL описываться ровно одной из трёх форм, и это SHALL
проверять тип:

| Форма | Когда применяется |
|---|---|
| `{ endpoints, providers? }` | состав одной фичи без имени, плоский слой провайдеров |
| `{ endpoints, modules? }` | состав одной фичи без имени, уже разложенный модулями |
| `{ features }` | приложение из нескольких единиц с выбором |

Смешанная запись (`endpoints` вместе с `features`, `providers` вместе с
`modules`) SHALL быть ошибкой компиляции, а рантайм SHALL повторять
проверку сообщением с перечнем трёх форм.

Корень первых двух форм SHALL нормализоваться во внутреннюю единицу с
ролью фичи и именем `app`. Endpoint'ы такого корня SHALL получать
атрибуцию этим именем, а его провайдеры — метку модуля `app`.

Поле `providers:` SHALL NOT приниматься в форме с `features:`: провайдер,
общий для нескольких фич, объявляется плагином — иначе у ребра «фича →
провайдер корня» не будет владельца (capability `feature-boundary`).

`makeApp` SHALL возвращать декларацию приложения — брендированное значение,
проверенное при создании: бренды фич и плагинов, дубли имён, дубли имён
переключателей, форма состава, закрытый перечень полей. Поля `select` в
словаре SHALL NOT существовать: выбор фич — часть аргумента сборки.

`App` SHALL предоставлять два метода: `assemble(args?)`, синхронно
возвращающий `AssembledApp`, и `check(args?, options?)` (capability
`structural-check`). `assemble` SHALL NOT читать конфиг и SHALL NOT
строить граф: фазы 0–5 выполняет `run()` собранного приложения. Ошибки
аргумента сборки (неизвестное имя фичи, пустой выбор, выбор без
`features`, значение переключателя не из словаря) SHALL бросаться на фазе
ASSEMBLE из `run()` или `check()`.

Поле `policies?` SHALL принимать список значений-политик — инвариантов,
проверяемых на собранном приложении (capability `assembly-policies`). Оно
SHALL оставаться опциональным: приложение без инвариантов собирается ровно
как прежде.

Публичного конструктора приложения SHALL NOT существовать: `AssembledApp`
SHALL оставаться экспортированным типом результата с методами `run()` и
`close()`, а его конструктор SHALL принимать внутренний нормализованный
план сборки, тип которого не экспортируется, — так `new AssembledApp({ … })`
невыразим по типам без рантайм-проверок.

#### Scenario: L0 — endpoint'ы и транспорт без фичи

- **WHEN** написано `await makeApp({ endpoints: [CreateOrder], providers: [OrdersService], transports: [http({ port: 3000 })] }).assemble().run()`
- **THEN** приложение поднимается, HTTP-endpoint'ы обслуживаются, и
  `makeFeature` в коде не встречается

#### Scenario: L2 — фичи и выбор

- **WHEN** написано `await makeApp({ features: [OrdersFeature], transports: [http()] }).assemble().run()`
- **THEN** приложение поднимается, а состав выбирается аргументом сборки

#### Scenario: Смешанная форма не компилируется

- **WHEN** написано `makeApp({ endpoints: [CreateOrder], features: [OrdersFeature] })`
- **THEN** это ошибка компиляции: форма состава одна из трёх

#### Scenario: Endpoint корня атрибутируется единице `app`

- **WHEN** приложение объявлено формой `{ endpoints, providers }` и
  проверено `check()`
- **THEN** endpoint отчёта называет модуль `app`, и узлы провайдеров несут
  ту же метку

#### Scenario: Провайдеры рядом с фичами не компилируются

- **WHEN** написано `makeApp({ features: [OrdersFeature], providers: [Clock] })`
- **THEN** это ошибка компиляции, а сообщение рантайма называет плагин как
  место для общего провайдера

#### Scenario: Приложение нельзя собрать конструктором

- **WHEN** код пишет `new AssembledApp({ features: [OrdersFeature] })`
- **THEN** это ошибка компиляции: тип плана сборки не экспортируется

#### Scenario: Пустая сборка легальна

- **WHEN** вызвано `makeApp({}).assemble()` и затем `run()`
- **THEN** приложение собирается и поднимается без транспортов и endpoint'ов

#### Scenario: Инварианты объявлены полем декларации

- **WHEN** написано `makeApp({ features: [UsersFeature], transports: [http()], policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase)] })`
- **THEN** политики проверяются на фазе ASSEMBLE того же прогона, отдельной
  функции запуска проверок не существует

#### Scenario: `assemble` ничего не читает

- **WHEN** вызвано `app.assemble('orders')` без последующего `run()`
- **THEN** `process.env` не прочитан, граф не построен, экземпляры не созданы

#### Scenario: `select` в словаре не компилируется

- **WHEN** написано `makeApp({ features: [OrdersFeature], select: 'orders' })`
- **THEN** это ошибка компиляции: перечень полей закрыт, выбор передаётся
  в `assemble`

### Requirement: Корень перечисляет фичи, плагины и транспорты

`makeApp` SHALL принимать `features`, `endpoints`, `modules`, `plugins`,
`providers`, `switches`, `transports`, `intercom`, `config`, `policies` и
`logger`.

Аргумент сборки SHALL передаваться в `assemble(args?)` и `check(args?)` в
трёх формах: строка (`'all'`, `'orders,billing'`), массив имён фич и
объект `{ features?, includeDeps?, …значения переключателей }`. Тип
объектной формы SHALL выводиться из `switches:` (capability
`composition-switches`).

`switches` SHALL принимать список переключателей состава. Без поля
переключателей у приложения нет, и объектная форма аргумента SHALL
принимать только `features` и `includeDeps`.

`logger` SHALL принимать готовое значение типа `Logger` и SHALL быть
единственным способом заменить корневой логгер ядра (capability
`kernel-logger`). Без него корнем SHALL быть `ConsoleLogger`, созданный от
снимка kernel-секции `nestlingLog`. Значение SHALL быть готовым: корневой
логгер существует раньше графа, поэтому зависеть от его узлов SHALL NOT
мочь.

`intercom` SHALL назначать роль переносчика операций **ссылкой** на уже
объявленный транспорт, а не объявлять второй транспорт. Назначенный
транспорт SHALL реализовывать `IMessageBus`; иное значение SHALL отвергаться
типом.

Ветка «шину поставил корень» SHALL определяться назначением роли, а не
присутствием провайдера в поле `transports:`.

#### Scenario: Логгер приложения задан опцией

- **WHEN** написано `makeApp({ features: [UsersFeature], transports: [http()], logger: pinoAdapter })`
- **THEN** записи всех фаз, включая предупреждения сборки, уходят в
  `pinoAdapter`, а члены `Logger$(scope)` строятся от него

#### Scenario: Без опции работает умолчание ядра

- **WHEN** поле `logger` не указано
- **THEN** корнем служит `ConsoleLogger` с уровнем и форматом из секции
  `nestlingLog`

#### Scenario: Роль назначается ссылкой

- **WHEN** декларация объявляет `transports: [http(), kafka({ name: 'events' })]`
  и `intercom: 'events'`
- **THEN** операции переносит именованный транспорт `events`, а второго
  объявления не требуется

#### Scenario: Транспорт без шины в роль интеркома не встаёт

- **WHEN** в `intercom:` назначен HTTP-транспорт
- **THEN** компилятор отвергает назначение: требуется `IMessageBus`

#### Scenario: Интерком не объявлен

- **WHEN** поле `intercom:` отсутствует
- **THEN** операции доставляются внутри процесса, а вызов, которому некуда
  уйти, роняет сборку с именем операции

#### Scenario: Выбор — аргумент сборки

- **WHEN** декларация объявляет `features: [OrdersFeature, BillingFeature]`,
  а процесс вызывает `app.assemble('orders').run()`
- **THEN** собрана только фича `orders`, а декларация не изменилась и
  пригодна для `app.assemble('all')` в другом процессе

#### Scenario: Значения переключателей идут тем же аргументом

- **WHEN** декларация объявляет `switches: [Storage]`, а процесс вызывает
  `app.assemble({ features: 'all', storage: 'local' })`
- **THEN** собраны все фичи, а из ветки `Storage.pick({ … })` в граф вошли
  провайдеры `local`
