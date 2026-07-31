# test-composition-root

## Purpose

Тестовый composition root `assembleTest(spec)` из `@nestling/testing` — та же
сборка, что боевая, остановленная после фазы `3 WIRE`: граф собран, `@OnInit`
выполнены, `dispatch` рождён, но START не наступает — транспорты не в эфире,
обработчики сигналов процесса не ставятся. Это середина, которой раньше не
было: между юнитом на голых классах и e2e с сокетом появляется app-тест,
гоняющий запрос через **полный пайплайн** in-proc (`app.call`). Словарь
сборки пополняется единственным ключом `overrides` — правом подстановки,
которого у боевого корня нет и не будет. Конфиг теста задаётся объектом
(`vars()`), а не `process.env`, поэтому тесты изолированы и параллелимы;
`await using` завершает прогон честным SHUTDOWN'ом.

## Requirements

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

### Requirement: `overrides` существует только у тестового корня

Поле `overrides: [[Token, fake], …]` SHALL приниматься `assembleTest` и
SHALL передаваться контейнеру как подстановка узла графа. Право override
SHALL быть позиционным: подменяется только тот токен, ссылка на который есть
у теста. Строковой формы доступа к токену (`overrideByName('…')`)
SHALL NOT существовать.

Пара `[Token, fake]` SHALL быть типизирована: значение, не совместимое с
типом токена, SHALL быть ошибкой компиляции.

#### Scenario: Подстановка вместо боевого узла

- **WHEN** `overrides: [[UsersRepository, inMemoryUsersRepo()]]`
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

### Requirement: `app.call` исполняет ручку через полный пайплайн

`TestApp.call(endpoint, input, options?)` SHALL находить декларацию по
**идентичности значения** среди обнаруженных дискавери и исполнять её через
`dispatch` её транспорта — со всеми слоями пайплайна, валидацией схем и
стражем границы.

Тип `input` SHALL выводиться из `input`-формы декларации, тип результата —
`ResponseContext<InferOutput<O>>`. Ветка отказа SHALL нести `status` и `code`
отказа из закрытого контракта `errors:`.

Декларация, отсутствующая в собранном приложении, SHALL давать ошибку с
перечнем доступных ручек.

#### Scenario: Успешный вызов

- **WHEN** `await app.call(CreateUser, { name: 'Alice' })`
- **THEN** пайплайн ручки выполнен целиком, результат — успешный
  `ResponseContext` со значением по `output`-схеме

#### Scenario: Объявленный отказ

- **WHEN** хендлер возвращает отказ из своего `errors:`
- **THEN** результат — `{ isSuccess: false }` с `status` отказа и его `code`

#### Scenario: Невалидный вход

- **WHEN** `input` не проходит схему декларации
- **THEN** результат — отказ валидации, тот же, что получил бы клиент через
  транспорт

#### Scenario: Ручка не выбрана `select`

- **WHEN** тест вызывает декларацию фичи, не попавшей в `select`
- **THEN** бросается ошибка, называющая декларацию и перечисляющая
  доступные ручки

#### Scenario: Кадр запроса пуст, но честен

- **WHEN** слой пайплайна читает `raw.transport` и `raw.pattern`
- **THEN** он видит имя транспорта декларации и её паттерн, а `raw.attributes`
  пуст, если тест не задал их через `options`

### Requirement: `unwrap` и доступ к графу

`@nestling/testing` SHALL экспортировать `unwrap(response)`, возвращающую
значение успешного ответа и бросающую ошибку с деталями отказа — включая
`status` и `code` — на ветке неуспеха.

`TestApp.get(token)` SHALL возвращать инстанс узла графа или `null`.
`TestApp.pruned` SHALL перечислять id узлов, выпавших прунингом.

#### Scenario: Ожидаю успех

- **WHEN** `unwrap(await app.call(GetUser, { id: '1' }))`
- **THEN** возвращается значение ответа без ручного сужения по `isSuccess`

#### Scenario: Отказ вместо ожидаемого успеха

- **WHEN** `unwrap` получает ответ-отказ
- **THEN** бросается ошибка, в сообщении которой видны `status` и `code`

#### Scenario: Что выпало из графа

- **WHEN** репозиторий подменён фейком, а pg-пул был нужен только ему
- **THEN** `app.pruned` содержит id узла пула

### Requirement: `await using` завершает тестовый прогон SHUTDOWN'ом

`TestApp` SHALL реализовывать `Symbol.asyncDispose` и SHALL экспонировать
идемпотентный `close()`. Завершение SHALL взводить общий `AbortSignal`,
переданный в каждый `call`, и затем выполнять `@OnDestroy` в реверсе
топологического порядка.

#### Scenario: Канонический вид теста

- **WHEN** `await using app = await assembleTest({ … })` и блок теста
  завершился
- **THEN** `@OnDestroy` всех узлов выполнены в реверсе, ресурсы отпущены

#### Scenario: Форма без `using`

- **WHEN** приложение собрано в `beforeEach` и закрыто в `afterEach`
  вызовом `await app.close()`
- **THEN** результат тот же, повторный `close()` безопасен

#### Scenario: In-flight отменяется на закрытии

- **WHEN** `close()` вызван во время незавершённого `call`
- **THEN** `ctx.signal` этого вызова взведён

### Requirement: `vars()` — конфиг теста объектом, а не `process.env`

`@nestling/testing` SHALL экспортировать `vars(record)`, возвращающую
именованный объектный `ConfigSource` с `watch`, `set` и `assign`.
`process.env` SHALL NOT изменяться ни `vars`, ни тестовым корнем.

Поле `config` тестового корня SHALL принимать три формы: `ConfigSource`
(эквивалент привязки `[[source, '*']]`), одну привязку и список привязок.

#### Scenario: Секция читается из объекта

- **WHEN** `config: vars({ USERS_PAGE_SIZE: '10' })`
- **THEN** секция проецируется из этих значений, а `process.env` остаётся
  нетронутым — тесты изолированы и параллелимы

#### Scenario: Reload проверяется программно

- **WHEN** тест зовёт `src.set('USERS_PAGE_SIZE', '20')` на reloadable-секции
- **THEN** секция перепроецируется, подписчики `onChange` уведомлены

### Requirement: `familyOverride` подменяет рецепт семейства

`@nestling/testing` SHALL экспортировать
`familyOverride(Family, (param) => value)`, значение которого принимается в
том же списке `overrides`. Подмена SHALL применяться **до** материализации
членов, поэтому ни один член SHALL NOT создаваться боевым рецептом.

#### Scenario: Логгер во всём приложении — no-op

- **WHEN** `overrides: [familyOverride(ILogger, () => noopLogger)]`
- **THEN** каждый инжект `ILogger('users')`/`ILogger('orders')` получает
  no-op, а боевой рецепт не вызывается ни разу

### Requirement: `contextValue` — request-контекст подставляется подменой провайдера

`@nestling/testing` SHALL экспортировать `contextValue(variable, value)` —
сахар над `valueProvider(Ctx(variable), …)`, дающий ридер с фиксированным
значением (`get()` возвращает его, `peek()` — то же значение).

Помощник SHALL ехать в тестовый корень тем же списком, что и остальные
подмены, и SHALL работать вне запроса: ALS для теста сервиса, читающего
ambient-переменную, SHALL NOT требоваться.

Прогон `app.call` SHALL при этом продолжать открывать настоящий scope: тест,
не подменивший ридер, SHALL видеть то же поведение проекции, что и бой.

#### Scenario: Сервис тестируется без запроса

- **WHEN** тестовый корень собран с `contextValue(RequestId, 'req-1')`
- **THEN** сервис с `Ctx(RequestId)` в `deps` читает `'req-1'` при прямом
  вызове из теста, без `app.call`

#### Scenario: Подмена приоритетна

- **WHEN** тот же корень исполняет ручку через `app.call`, а её пайплайн
  кладёт другой `requestId`
- **THEN** инжектированный сервис читает подставленное значение: подмена
  провайдера сильнее рецепта семейства

#### Scenario: Без подмены — боевое поведение

- **WHEN** тест не подменял ридер и зовёт `app.call`
- **THEN** сервис читает значение, положенное пайплайном, а вне вызова
  `peek()` возвращает `undefined`
