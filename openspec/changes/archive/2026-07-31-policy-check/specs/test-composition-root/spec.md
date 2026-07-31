## MODIFIED Requirements

### Requirement: `assembleTest` — тестовый composition root

`@nestling/testing` SHALL экспортировать
`assembleTest(spec): Promise<TestApp>`, принимающую тот же словарь сборки,
что и `assemble` (`modules`, `providers`, `features`, `select`, `transports`,
`config`, `policies`), плюс поле `overrides`. Функция SHALL проводить
приложение по фазам `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE` и
остановиться.

Тестовый прогон SHALL выполнять те же проверки фазы ASSEMBLE, что и боевой:
сверку требуемых транспортов с графом, проверку форм io против способностей
транспортов, проверку ацикличности и проверку объявленных политик
(capability `assembly-policies`). Тестовый корень SHALL NOT ослаблять
инварианты.

#### Scenario: Приложение собрано, но не в эфире

- **WHEN** `await assembleTest({ features: [UsersFeature], transports: [http()] })`
- **THEN** `@OnInit` выполнены, `dispatch` построен, `@OnStart` не выполнен,
  `serve` ни на одном транспорте не вызван и сокет не открыт

#### Scenario: Тестовый прогон не трогает процесс

- **WHEN** тестовое приложение собрано
- **THEN** обработчики `SIGTERM`/`SIGINT` не установлены и строка состава
  сборки в stdout не печатается

#### Scenario: Fail-fast сборки работает и в тесте

- **WHEN** выбранная фича объявляет HTTP-ручку, а `transports:` пуст
- **THEN** `assembleTest` отклоняется той же ошибкой, что и боевая сборка,
  и `@OnInit` не выполняется

#### Scenario: Инвариант проверяется и в тесте

- **WHEN** `assembleTest({ …, policies: [everyEndpoint().hasLayer(authedBase)] })`
  собирает приложение с ручкой без требуемого слоя
- **THEN** вызов отклоняется тем же нарушением политики, что и боевая
  сборка
</content>
