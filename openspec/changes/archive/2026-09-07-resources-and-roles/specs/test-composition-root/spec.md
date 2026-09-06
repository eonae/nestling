## MODIFIED Requirements

### Requirement: `assembleTest` — тестовый composition root

`@nestling/testing` SHALL экспортировать
`assembleTest(app, options?): Promise<TestApp>`, принимающую декларацию
приложения `makeApp` первым аргументом и словарь опций вторым: `select`,
`overrides`, `stubs`, `config`, `contextValue`. Функция SHALL проводить
приложение по фазам `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE` и
остановиться.

Состав приложения (фичи, плагины, провайдеры, транспорты, интерком,
политики) SHALL браться из декларации; в опциях SHALL NOT существовать ни
полей состава, ни `policies`, ни `transports`. Поле `config` опций SHALL
заменять привязку источников декларации целиком: тест изолирован от
источников приложения так же, как от `process.env`.

Тестовый прогон SHALL выполнять те же проверки фазы ASSEMBLE, что и боевой:
сверку требуемых транспортов с графом, проверку форм io против способностей
объявленных транспортов, проверку ацикличности и проверку объявленных
политик (capability `assembly-policies`). Тестовый корень SHALL NOT
ослаблять инварианты.

#### Scenario: Приложение собрано, но запросов не принимает

- **WHEN** `await assembleTest(app)`, где `app = makeApp({ features: [UsersFeature], transports: [http()] })`
- **THEN** экземпляры созданы, ресурсы захвачены, `dispatch` построен,
  `@OnStart` не выполнен, `serve` ни на одном транспорте не вызван и сокет
  не открыт

#### Scenario: Тестовый прогон не трогает процесс

- **WHEN** тестовое приложение собрано
- **THEN** обработчики `SIGTERM`/`SIGINT` не установлены и строка состава
  сборки в stdout не печатается

#### Scenario: Fail-fast сборки работает и в тесте

- **WHEN** выбранная фича объявляет HTTP-endpoint, а `transports:`
  декларации пуст
- **THEN** `assembleTest` отклоняется той же ошибкой, что и боевая сборка,
  и ни один конструктор не выполняется

#### Scenario: Инвариант проверяется и в тесте

- **WHEN** декларация несёт `policies: [everyEndpoint().hasLayer(authedBase)]`,
  а `assembleTest(app, …)` собирает приложение с endpoint'ом без требуемого
  слоя
- **THEN** вызов отклоняется тем же нарушением политики, что и боевая
  сборка

### Requirement: `await using` завершает тестовый прогон SHUTDOWN'ом

`TestApp` SHALL реализовывать `Symbol.asyncDispose` и SHALL экспонировать
идемпотентный `close()`. Завершение SHALL взводить общий `AbortSignal`,
переданный в каждый `call`, и затем вызывать `release` ресурсов в реверсе
топологического порядка.

#### Scenario: Канонический вид теста

- **WHEN** `await using testApp = await assembleTest({ … })` и блок теста
  завершился
- **THEN** `release` всех ресурсов выполнены в реверсе, ресурсы отпущены

#### Scenario: Форма без `using`

- **WHEN** приложение собрано в `beforeEach` и закрыто в `afterEach`
  вызовом `await testApp.close()`
- **THEN** результат тот же, повторный `close()` безопасен
