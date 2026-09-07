# transport-providers Specification (delta)

## RENAMED Requirements

- FROM: `### Requirement: Фактический адрес транспорта доступен после go-live`
- TO: `### Requirement: Фактический адрес отдаёт сервер`

## MODIFIED Requirements

### Requirement: Порт и адрес транспорта приходят из конфиг-секции

Сокетом SHALL владеть сервер, а не транспорт (capability
`http-server-resource`). `@nestling/transport.http` SHALL объявлять
конфиг-секцию сервера с префиксом по имени экземпляра (`HTTP_PORT`,
`HTTP_HOST`, `HTTP_ADMIN_PORT`, `HTTP_ADMIN_HOST`) и читать её в
провайдере сервера. Опций `port` и `host` у фабрик `httpServer()` и
`http()` SHALL NOT быть: значение приходит только из конфига. Наружу из
пакета SHALL отдаваться только `httpServerKeys(name?)` — токен секции
SHALL NOT экспортироваться.

Опции транспорта, не зависящие от окружения (`maxBodySize`,
`sseHeartbeat`), SHALL оставаться аргументом `http()`. Таймауты
`node:http` SHALL переходить аргументом `httpServer()`.

#### Scenario: Порт из env

- **WHEN** задан `HTTP_PORT=8080`, а корень объявлен как `transports: [http()]`
- **THEN** сервер слушает порт 8080

#### Scenario: Порта в опциях фабрики нет

- **WHEN** автор пишет `http({ port: 3000 })`
- **THEN** это ошибка типов: у опций транспорта нет поля `port`

#### Scenario: Невалидный порт падает на сборке

- **WHEN** задан `HTTP_PORT=abc`
- **THEN** старт падает валидацией конфига до захвата сокета

### Requirement: Фактический адрес отдаёт сервер

Фактический адрес SHALL отдавать сервер: `address(): { host, port } | null`.
До `listen` и после дренажа он SHALL возвращать `null`. У транспорта
метода `address()` SHALL NOT быть.

#### Scenario: Порт 0 в тестах

- **WHEN** приложение поднято с `HTTP_PORT=0` и фаза START завершилась
- **THEN** `address()` сервера возвращает фактически занятый порт

#### Scenario: Адреса нет до старта

- **WHEN** сервер создан, но `listen` ещё не вызван
- **THEN** `address()` возвращает `null`

### Requirement: Транспорт — обычный провайдер с токеном

Каждый транспортный пакет SHALL экспортировать токен своего транспорта и
фабрику объявления: `@nestling/transport.http` — `http(options?)`,
`@nestling/transport.cli` — `cli(options?)`. Фабрика SHALL возвращать
**объявление** с провайдером, токеном, именем экземпляра и способностями
(capability `transport-form-capabilities`), а не инстанс: зависимости
транспорта SHALL инжектироваться контейнером, а его создание и остановка
SHALL идти по графу наравне с прочими узлами.

Поле `transports:` в `makeApp` SHALL быть местом этих объявлений. Оно
SHALL принимать и объявления серверов (capability
`http-server-resource`); объявления SHALL различаться дискриминатором, а
не догадкой по форме.

Прямое конструирование (`new HttpTransport(server, options)`) SHALL
оставаться доступным для standalone-пути и SHALL NOT требовать
контейнера. Сервер на этом пути создаётся тем же способом и передаётся
транспорту аргументом.

#### Scenario: Транспорт в корне

- **WHEN** `makeApp({ features: [OrdersFeature], transports: [http()] })`
- **THEN** транспорт и его сервер создаются контейнером на фазе INIT, а их
  остановка идёт вместе с прочими узлами графа

#### Scenario: Транспорт приходит модулем фичи

- **WHEN** infra-модуль выбранной фичи объявляет `providers: [http()]`, а в
  корне поля `transports` нет
- **THEN** транспорт присутствует в графе и обслуживает endpoint'ы этой фичи

#### Scenario: Способности объявления читаются до графа

- **WHEN** `App` проверяет формы io на фазе ASSEMBLE
- **THEN** способности берутся из объявления в `transports:`, и транспорт
  при этом не создаётся

#### Scenario: Standalone-конструирование

- **WHEN** в тесте создан сервер и выполнено `new HttpTransport(server)`
- **THEN** оба объекта создаются без контейнера
