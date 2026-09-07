## MODIFIED Requirements

### Requirement: `assembleTest` — тестовый composition root

`@nestling/testing` SHALL экспортировать
`assembleTest(app, options?): Promise<TestApp>`, принимающую декларацию
приложения `makeApp` первым аргументом и словарь опций вторым: `args`,
`overrides`, `stubs`, `config`, `contextValue`. Функция SHALL проводить
приложение по фазам `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE` и
остановиться.

Опция `args` SHALL принимать аргумент сборки в тех же формах, что
`app.assemble(args?)`: строку, массив имён фич и объект с `features`,
`includeDeps` и значениями переключателей (capability
`composition-switches`). Опции `select` SHALL NOT существовать: топология
теста описывается тем же значением, что топология процесса.

Состав приложения (фичи, плагины, провайдеры, транспорты, интерком,
политики) SHALL браться из декларации; в опциях SHALL NOT существовать ни
полей состава, ни `policies`, ни `transports`. Поле `config` опций SHALL
заменять привязку источников декларации целиком: тест изолирован от
источников приложения так же, как от `process.env`.

Тестовый прогон SHALL выполнять те же проверки фазы ASSEMBLE, что и боевой:
раскрытие веток переключателей, сверку требуемых транспортов с графом,
проверку форм io против способностей объявленных транспортов, проверку
ацикличности и проверку объявленных политик (capability
`assembly-policies`). Тестовый корень SHALL NOT ослаблять инварианты.

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

#### Scenario: Та же декларация, что у `main.ts`

- **WHEN** тест импортирует `app` из `app.ts` и вызывает
  `assembleTest(app, { overrides: [[UsersRepository$, fake]] })`
- **THEN** словарь сборки не копируется и не спредится; состав совпадает с
  боевым

#### Scenario: Конфиг теста заменяет привязку декларации

- **WHEN** декларация объявляет `config: [[vault(), ['*']]]`, а тест
  передаёт `config: vars({ API_TOKEN: 't' })`
- **THEN** `vault()` не инициализируется и не читается; секции читаются из
  `vars`

#### Scenario: Выбор фич в тесте

- **WHEN** `assembleTest(app, { args: 'orders' })`
- **THEN** собрана только фича `orders`, как при `app.assemble('orders')`

#### Scenario: Ветка переключателя в тесте

- **WHEN** `assembleTest(app, { args: { storage: 'local' } })`
- **THEN** в графе провайдеры ветки `local`, и ни один провайдер ветки
  `s3` не создан
