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
