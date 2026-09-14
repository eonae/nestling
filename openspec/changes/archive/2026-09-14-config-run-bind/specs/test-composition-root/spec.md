## ADDED Requirements

### Requirement: `testApp.run()` доводит приложение до RUN

`TestApp` SHALL экспонировать `run(): Promise<void>`, продолжающий фазы
после `3 WIRE`, на которых останавливается `buildTest`, — `4 START` и
`5 RUN`: `@OnStart` выполняется, `serve` каждого объявленного транспорта
вызывается, слушатели открывают сокеты. Тестовый прогон SHALL NOT
устанавливать обработчики `SIGTERM`/`SIGINT` и SHALL NOT печатать строку
состава сборки: `run()` тестового приложения остаётся тестовым прогоном, а
не вторым способом поднять боевой процесс.

`testApp.close()`/`Symbol.asyncDispose` SHALL выполнять фазу SHUTDOWN
целиком, если `run()` был вызван, — включая `drain()` открытых слушателей,
— и оставаться идемпотентным так же, как без вызова `run()`.

#### Scenario: `run()` открывает сокет

- **WHEN** `const testApp = await buildTest(app); await testApp.run()`,
  где `app` объявляет `transports: [http()]`
- **THEN** `@OnStart` выполнен, `serve` HTTP-транспорта вызван, и сервер
  принимает соединения на выданном порту

#### Scenario: `run()` не трогает процесс

- **WHEN** тестовое приложение поднято `testApp.run()`
- **THEN** обработчики `SIGTERM`/`SIGINT` не установлены, и строка состава
  сборки в stdout не печатается

#### Scenario: Закрытие после `run()` дренирует сокет

- **WHEN** `await using testApp = await buildTest(app)`, вызван
  `await testApp.run()`, и блок теста завершился
- **THEN** слушатель прошёл `drain()` до разрушения ресурсов графа, сокет
  закрыт

### Requirement: `testApp.baseUrl(name?)` — адрес поднятого сервера

`TestApp` SHALL экспонировать `baseUrl(name?: string): string`, резолвящий
базовый адрес сервера, поднятого `run()`:

- без аргумента — если объявлен ровно один сервер, его адрес; ноль или
  больше одного сервера SHALL быть явным отказом, перечисляющим имена
  доступных серверов;
- с аргументом — адрес сервера `servers.get(name)`; отсутствие сервера с
  таким именем SHALL быть явным отказом с перечнем доступных имён.

Сервер, не реализующий необязательную способность `baseUrl?()` листенера
(транспортная граница ядра; для HTTP её реализует `HttpServer`), SHALL
давать явный отказ, называющий сервер, — не `undefined`.

Вызов `baseUrl()` до `run()` SHALL быть отказом: адреса без открытого
сокета не существует.

#### Scenario: Единственный сервер — без имени

- **WHEN** объявлен один транспорт `http()`, и вызван `testApp.baseUrl()`
  после `run()`
- **THEN** возвращается адрес с фактическим host и портом сервера

#### Scenario: Несколько серверов требуют имени

- **WHEN** объявлены `transports: [http({ port: 3000 }), http({ port: 3001, name: 'admin' })]`,
  и вызван `testApp.baseUrl()` без аргумента
- **THEN** вызов отказывает, перечисляя имена `default` и `admin`

#### Scenario: Адрес именованного сервера

- **WHEN** та же декларация, и вызван `testApp.baseUrl('admin')`
- **THEN** возвращается адрес сервера порта `3001`

#### Scenario: До `run()` адреса нет

- **WHEN** `testApp.baseUrl()` вызван сразу после `buildTest`, без
  `run()`
- **THEN** вызов отказывает: сокет не открыт

## MODIFIED Requirements

### Requirement: `buildTest` — тестовый composition root

`@nestlingjs/testing` SHALL экспортировать
`buildTest(app, options?): Promise<TestApp>`, принимающую декларацию
приложения `makeApp` первым аргументом и словарь опций вторым: `args`,
`overrides`, `stubs`, `config`, `contextValue`. Функция SHALL проводить
приложение по фазам `0 BOOTSTRAP → 1 BUILD → 2 INIT → 3 WIRE` и
остановиться; `testApp.run()` продолжает до `RUN` (требование «`testApp.run()`
доводит приложение до RUN» выше).

Опция `args` SHALL принимать аргумент сборки в тех же формах, что
`app.build(args?)`: строку, массив имён фич и объект с `features`,
`includeDeps` и значениями переключателей (capability
`composition-switches`). Опции `select` SHALL NOT существовать: топология
теста описывается тем же значением, что топология процесса.

Состав приложения (фичи, плагины, провайдеры, транспорты, интерком,
политики) SHALL браться из декларации; в опциях SHALL NOT существовать ни
полей состава, ни `policies`, ни `transports`. Поле `config` опций SHALL
быть единственным источником привязок тестового корня — у декларации
привязок нет вовсе (capability `config-sources-binding`). Без опции
`config` источники SHALL NOT подниматься: тест изолирован и от
`process.env`, и от любых умолчаний.

Тестовый прогон SHALL выполнять те же проверки фазы BUILD, что и боевой:
раскрытие веток переключателей, сверку требуемых транспортов с графом,
проверку форм io против способностей объявленных транспортов, проверку
ацикличности и проверку объявленных политик (capability
`build-policies`). Тестовый корень SHALL NOT ослаблять инварианты.

#### Scenario: Приложение собрано, но запросов не принимает

- **WHEN** `await buildTest(app)`, где `app = makeApp({ features: [UsersFeature], transports: [http()] })`
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
- **THEN** `buildTest` отклоняется той же ошибкой, что и боевая сборка,
  и ни один конструктор не выполняется

#### Scenario: Инвариант проверяется и в тесте

- **WHEN** декларация несёт `policies: [everyEndpoint().hasLayer(authedBase)]`,
  а `buildTest(app, …)` собирает приложение с endpoint'ом без требуемого
  слоя
- **THEN** вызов отклоняется тем же нарушением политики, что и боевая
  сборка

#### Scenario: Та же декларация, что у `main.ts`

- **WHEN** тест импортирует `app` из `app.ts` и вызывает
  `buildTest(app, { overrides: [[UsersRepository$, fake]] })`
- **THEN** словарь сборки не копируется и не спредится; состав совпадает с
  боевым

#### Scenario: Без опции `config` источников нет

- **WHEN** декларация объявляет секцию с обязательным ключом без
  умолчания, а `buildTest(app)` вызван без опции `config`
- **THEN** сборка отказывает валидацией секции: источника для значения нет,
  `process.env` не читается

#### Scenario: Выбор фич в тесте

- **WHEN** `buildTest(app, { args: 'orders' })`
- **THEN** собрана только фича `orders`, как при `app.build('orders')`

#### Scenario: Ветка переключателя в тесте

- **WHEN** `buildTest(app, { args: { storage: 'local' } })`
- **THEN** в графе провайдеры ветки `local`, и ни один провайдер ветки
  `s3` не создан

### Requirement: `vars()` — конфиг теста объектом, а не `process.env`

`@nestlingjs/testing` SHALL экспортировать `vars(record)`, возвращающую
именованный объектный `ConfigSource` с `watch`, `set` и `assign`.
`process.env` SHALL NOT изменяться ни `vars`, ни тестовым корнем.

Поле `config` тестового корня SHALL принимать список `bind(source,
options?)` — ту же форму, что опция `config` боевого `run()` (capability
`config-sources-binding`). Голого источника без `bind()` в списке SHALL NOT
быть: форма привязки одна на оба корня.

#### Scenario: Секция читается из объекта

- **WHEN** `config: [bind(vars({ USERS_PAGE_SIZE: '10' }))]`
- **THEN** секция проецируется из этих значений, а `process.env` остаётся
  нетронутым — тесты изолированы и параллелимы

#### Scenario: Reload проверяется программно

- **WHEN** тест зовёт `src.set('USERS_PAGE_SIZE', '20')` на reloadable-секции
- **THEN** секция перепроецируется, подписчики `onChange` уведомлены
