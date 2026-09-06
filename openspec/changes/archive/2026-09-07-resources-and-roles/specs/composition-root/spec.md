## MODIFIED Requirements

### Requirement: Корень перечисляет фичи, плагины и транспорты

`makeApp` SHALL принимать `features`, `plugins`, `providers`, `transports`,
`intercom`, `config`, `policies` и `logger`. Выбор фич SHALL передаваться
аргументом `assemble(select?)` и `check(select?)` в тех же формах, что
прежде: `'all'`, строка через запятую, массив имён,
`{ features, includeDeps }`.

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
