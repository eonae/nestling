# http-transport-boundary Specification (delta)

## ADDED Requirements

### Requirement: Обещания и границы HTTP-транспорта

`@nestling/transport.http` SHALL поддерживать HTTP/1.1 поверх `node:http`,
формы io `value`, `stream`, `multipart` на входе и `value`, `stream`,
`events` на выходе, `rawBody`, лимиты тела и файлов, настраиваемые
таймауты `node:http`, дренаж соединений при остановке и адрес из
конфиг-секции транспорта.

Пакет SHALL NOT реализовывать HTTP/2, WebSocket и TLS-терминацию. Эти
задачи SHALL решаться обратным прокси перед сервисом или отдельным
транспортом, а не расширением `@nestling/transport.http`.

#### Scenario: Транспорт объявляет свои формы io

- **WHEN** внешний код читает `capabilities` инстанса `HttpTransport`
- **THEN** значение равно `{ input: {value, stream, multipart}, output:
  {value, stream, events} }`

#### Scenario: HTTP/2, WebSocket и TLS остаются вне пакета

- **WHEN** приложению нужны HTTP/2, WebSocket или TLS-терминация
- **THEN** эти возможности предоставляет обратный прокси перед сервисом
  или отдельный транспорт, а не `@nestling/transport.http`

### Requirement: Байтовые части транспорта — публичная поверхность пакета

`packages/nestling.transport.http/src/index.ts` SHALL экспортировать
разбор тела запроса по форме io (JSON, сырые байты, NDJSON, multipart),
чтение bind-карты декларации, таблицу перевода статуса ответа в код HTTP и
кадрирование потокового ответа (NDJSON и SSE) одной функцией отправки.
Значение способностей транспорта SHALL быть доступно тем же экспортом,
которым пользуется сам `HttpTransport`, а не повторяться отдельным
литералом у потребителя.

#### Scenario: Разбор тела по форме доступен без класса транспорта

- **WHEN** внешний код импортирует `parseJson`, `parseNdjson` и
  `parseMultipartForm` из `@nestling/transport.http`, не создавая
  `HttpTransport`
- **THEN** каждая функция читает `IncomingMessage` и форму декларации так
  же, как их использует сам транспорт

#### Scenario: Bind-карта и таблица статусов читаются напрямую

- **WHEN** внешний код вызывает `httpBindingOf(declaration)` и
  `httpCodeOf(status)`
- **THEN** он получает те же карту размещения полей и код HTTP, что
  вычислил бы `HttpTransport` для того же запроса

#### Scenario: Кадрирование ответа — одна функция на обе потоковые формы

- **WHEN** внешний код вызывает `sendResponse(res, response, { kind })` с
  `kind: 'stream'` и отдельно с `kind: 'events'`
- **THEN** первый вызов пишет NDJSON, второй — SSE, без собственного кода
  кадрирования у вызывающей стороны

### Requirement: Satellite-транспорт пишется поверх стороннего HTTP-сервера без правок пакета

Реализация `ITransport` поверх HTTP-сервера, созданного независимо от
`HttpTransport` (в частности, отдельного `node:http`-сервера), SHALL
собираться из экспортов `@nestling/transport.http`, не изменяя файлы
пакета. Критерий SHALL проверяться тестом пакета: если тесту не хватает
экспорта, добавляется экспорт в пакет, а не обходной код внутри
satellite.

#### Scenario: Satellite обслуживает GET и POST

- **WHEN** тест пакета поднимает независимый `node:http`-сервер, привязывает
  к нему satellite-реализацию `ITransport`, построенную только из
  публичных экспортов, и вызывает через неё endpoint `GET` с JSON-ответом и
  endpoint `POST` с телом
- **THEN** оба запроса получают ответ, эквивалентный ответу того же
  `dispatch` через `HttpTransport`, и тест не обращается к приватным
  полям или неэкспортированным модулям пакета

#### Scenario: Пропущенный экспорт — повод расширить пакет, а не satellite

- **WHEN** при написании satellite обнаруживается, что нужная часть
  (например, значение способностей транспорта) не экспортирована
- **THEN** экспорт добавляется в `index.ts`, а satellite остаётся тонким
  переиспользованием пакета
