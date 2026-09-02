# composition-root Specification (delta)

## MODIFIED Requirements

### Requirement: Корень перечисляет фичи, плагины и транспорты

`assemble` SHALL принимать `features`, `plugins`, `transports`, `intercom`,
`select`, `config` и `policies`. Поле `modules:` SHALL быть переименовано в
`plugins:`.

`intercom` SHALL назначать роль переносчика операций **ссылкой** на уже
объявленный транспорт, а не объявлять второй транспорт. Назначенный
транспорт SHALL реализовывать `IMessageBus`; иное значение SHALL отвергаться
типом.

Ветка «шину поставил корень» SHALL определяться назначением роли, а не
присутствием провайдера в поле `transports:`.

#### Scenario: Роль назначается ссылкой

- **WHEN** корень объявляет `transports: [http(), kafka({ name: 'events' })]`
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
