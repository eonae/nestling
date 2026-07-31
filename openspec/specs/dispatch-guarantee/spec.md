# dispatch-guarantee

## Purpose

Гарантия «транспорт не может выйти в эфир раньше, чем приложение готово
обслуживать запросы» держится составом данных, а не конвенцией. Единственный
вход транспорта в эфир — `serve(dispatch, signal)`; `dispatch` — фазовый
ресурс, создаваемый в фазе WIRE и недоступный через контейнер. Он разделяет
провод и исполнение: `routes` — неисполнимые проекции деклараций для роутинга
и парсинга, `call(pattern, ctx, options?)` — единственный способ выполнить
ручку. Тот же `dispatch` обслуживает standalone-путь.

## Requirements

### Requirement: Единственный вход в эфир — `serve(dispatch, signal)`

`ITransport` SHALL объявлять go-live как `serve(dispatch: Dispatch, signal:
AbortSignal): Promise<void>`. Нульарного `listen()` в контракте транспорта
SHALL NOT существовать, равно как и метода регистрации отдельной ручки
(`endpoint()` / `route()` в роли обязательной точки контракта).

`signal` SHALL быть каналом остановки: его взвод означает «новые запросы не
принимаются, in-flight отменяются кооперативно».

#### Scenario: `listen()` невозможно вызвать

- **WHEN** код вызывает `transport.listen()`
- **THEN** это ошибка компиляции: метода в контракте нет

#### Scenario: Go-live требует диспетчера

- **WHEN** транспорт выходит в эфир
- **THEN** он обязан был принять `dispatch` аргументом — иного способа
  получить исполнимые ручки у него нет

### Requirement: `dispatch` — фазовый ресурс, разделяющий провод и исполнение

`@nestling/transport` SHALL экспортировать тип `Dispatch` и конструктор
`makeDispatch(endpoints)`, где `endpoints` — **исполнимые** декларации
(`TNeeds = never`). `Dispatch` SHALL нести:

- `routes` — проекции деклараций, содержащие всё нужное транспорту для
  роутинга и парсинга (паттерн, io-декларация, bind-карта, транспортный
  словарь, объявленные отказы) и SHALL NOT содержащие исполнимых полей
  (`handle`, `pipeline`, `deps`, `resolve`);
- `call(pattern, ctx, options?)` — исполнение ручки: выбор ветки
  «с pipeline / без pipeline» и её выполнение, возвращающее `ResponseContext`.

`makeDispatch` SHALL вызываться в фазе WIRE — после того, как зависимости
деклараций погашены контейнером. Один `dispatch` SHALL строиться на один
транспорт и SHALL содержать только его ручки.

#### Scenario: Проекция не содержит хендлера

- **WHEN** транспорт читает элемент `dispatch.routes`
- **THEN** в нём есть паттерн, формы io и bind-карта, но нет `handle` и
  `pipeline` — исполнить ручку из проекции невозможно

#### Scenario: Исполнение идёт через `call`

- **WHEN** транспорт распарсил запрос, построил контекст и вызвал
  `dispatch.call(pattern, ctx)`
- **THEN** выполняется pipeline ручки с её хендлером, и возвращается
  `ResponseContext`

#### Scenario: Декларация без pipeline

- **WHEN** ручка объявлена без `pipeline`, и транспорт вызвал
  `dispatch.call(pattern, ctx)`
- **THEN** `dispatch` выполняет прямой вызов хендлера по той же ветке для
  всех транспортов — дублирования этой логики в транспортах SHALL NOT быть

#### Scenario: Транспорт получает только свои ручки

- **WHEN** приложение обслуживает и HTTP-, и CLI-ручки
- **THEN** `dispatch`, переданный HTTP-транспорту, содержит только
  HTTP-маршруты

#### Scenario: Опции границы едут аргументом

- **WHEN** транспорт вызывает `call` с `{ exposeErrorDetails, onUnknownFail }`
- **THEN** исполнение учитывает их; сам `dispatch` этих политик SHALL NOT
  хранить

### Requirement: Ранний go-live невозможен структурно

Гарантия «`listen` на `@OnInit` невозможен» SHALL держаться составом данных,
а не конвенцией: до фазы START транспорт SHALL NOT иметь ни одной исполнимой
ручки. `dispatch` SHALL NOT быть доступен через контейнер (инжектом) и
SHALL NOT существовать до фазы WIRE.

#### Scenario: `dispatch` не инжектится

- **WHEN** провайдер объявляет зависимость от `dispatch`
- **THEN** такого токена нет: `dispatch` не регистрируется в контейнере

#### Scenario: Транспорт, открывший сокет в `@OnInit`, ничего не обслуживает

- **WHEN** автор транспорта открывает сокет в `@OnInit`
- **THEN** маршрутов у него нет и исполнить запрос нечем — «ранний listen»
  бесполезен, а не просто не рекомендован

### Requirement: Standalone-путь пользуется тем же `dispatch`

Транспорт, используемый без `App`, SHALL подниматься тем же способом:
`makeDispatch([…deps-free декларации])` + `serve(dispatch, signal)`.
Отдельного standalone-API регистрации ручек SHALL NOT существовать.
Декларация с неразрешёнными зависимостями SHALL NOT приниматься
`makeDispatch` по типам (`TNeeds = never`).

#### Scenario: Standalone HTTP-сервер

- **WHEN** написано `await transport.serve(makeDispatch([Ping]), controller.signal)`,
  где `Ping` — deps-free декларация
- **THEN** сервер поднимается и обслуживает `Ping`

#### Scenario: Декларация с `deps` в standalone

- **WHEN** в `makeDispatch` передана декларация с непогашенными `deps`
- **THEN** это ошибка компиляции — сначала `endpoint.resolve(resolver)`

#### Scenario: Остановка по сигналу

- **WHEN** взведён сигнал, переданный в `serve`
- **THEN** транспорт перестаёт принимать новые запросы и отменяет in-flight
