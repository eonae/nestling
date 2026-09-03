# test-composition-root Specification (delta)

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
транспортов, проверку ацикличности и проверку объявленных политик
(capability `assembly-policies`). Тестовый корень SHALL NOT ослаблять
инварианты.

#### Scenario: Приложение собрано, но не в эфире

- **WHEN** `await assembleTest(app)`, где `app = makeApp({ features: [UsersFeature], transports: [http()] })`
- **THEN** `@OnInit` выполнены, `dispatch` построен, `@OnStart` не выполнен,
  `serve` ни на одном транспорте не вызван и сокет не открыт

#### Scenario: Тестовый прогон не трогает процесс

- **WHEN** тестовое приложение собрано
- **THEN** обработчики `SIGTERM`/`SIGINT` не установлены и строка состава
  сборки в stdout не печатается

#### Scenario: Fail-fast сборки работает и в тесте

- **WHEN** выбранная фича объявляет HTTP-ручку, а `transports:` декларации
  пуст
- **THEN** `assembleTest` отклоняется той же ошибкой, что и боевая сборка,
  и `@OnInit` не выполняется

#### Scenario: Инвариант проверяется и в тесте

- **WHEN** декларация несёт `policies: [everyEndpoint().hasLayer(authedBase)]`,
  а `assembleTest(app, …)` собирает приложение с ручкой без требуемого слоя
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

- **WHEN** `assembleTest(app, { select: 'orders' })`
- **THEN** собрана только фича `orders`, как при `app.assemble('orders')`

### Requirement: `overrides` существует только у тестового корня

Поле `overrides: [[Token, fake], …]` SHALL приниматься `assembleTest` и
SHALL передаваться контейнеру как подстановка узла графа. Право override
SHALL быть позиционным: подменяется только тот токен, ссылка на который есть
у теста. Строковой формы доступа к токену (`overrideByName('…')`)
SHALL NOT существовать. Ни `makeApp`, ни `assemble` подстановок SHALL NOT
принимать.

Пара `[Token, fake]` SHALL быть типизирована: значение, не совместимое с
типом токена, SHALL быть ошибкой компиляции.

#### Scenario: Подстановка вместо боевого узла

- **WHEN** `assembleTest(app, { overrides: [[UsersRepository, inMemoryUsersRepo()]] })`
- **THEN** все потребители `UsersRepository` получают фейк, а боевой
  провайдер не инстанцируется

#### Scenario: Фейк не того типа

- **WHEN** в паре с токеном `InjectionToken<UsersRepository>` стоит объект
  без метода `findById`
- **THEN** это ошибка компиляции, а не рантайм-сюрприз

#### Scenario: Строкового override не существует

- **WHEN** тест пытается подменить приватный токен чужого пакета
- **THEN** такого API нет: подменяется либо экспортированный токен, либо
  модуль целиком

#### Scenario: Подстановка в декларации не компилируется

- **WHEN** написано `makeApp({ features: [...], overrides: [[Token, fake]] })`
- **THEN** это ошибка компиляции: перечень полей декларации закрыт

### Requirement: `stubs:` — поставка недостающего в тестовом корне

Опции `assembleTest` SHALL принимать поле `stubs: [[Token, value], …]` —
пары «токен → значение», регистрируемые обычными провайдерами. Поле SHALL
принимать значения `stub(Contract, impl)` наравне с обычными парами:
стаб операции — такая же пара, и отдельного поля под него SHALL NOT
существовать (capability `contract-stubs`).

Семантика поля — **поставка недостающего**, а не подмена: в отличие от
`overrides:`, `stubs:` SHALL NOT требовать, чтобы у токена уже был провайдер.

#### Scenario: Пара «токен → значение»

- **WHEN** `assembleTest(app, { stubs: [[IClock, fixedClock]] })`, где
  декларация объявляет `features: [ReportsFeature]`
- **THEN** `IClock` разрешается переданным значением

#### Scenario: Стаб операции в том же поле

- **WHEN** `assembleTest(app, { select: 'orders', stubs: [stub(ClaimQuota, async () => ({ granted: 1 }))] })`
- **THEN** сборка проходит без реализации `ClaimQuota` и без брокера, а
  потребитель получает фейк
