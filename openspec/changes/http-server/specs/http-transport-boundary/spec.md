# http-transport-boundary Specification (delta)

## MODIFIED Requirements

### Requirement: Обещания и границы HTTP-транспорта

`@nestling/transport.http` SHALL поддерживать HTTP/1.1 поверх `node:http`,
формы io `value`, `stream`, `multipart` на входе и `value`, `stream`,
`events` на выходе, `rawBody`, лимиты тела и файлов, настраиваемые
таймауты `node:http`, дренаж соединений при остановке и адрес из
конфиг-секции.

Сокет, `listen`, `address()`, таймауты `node:http` и дренаж SHALL
принадлежать серверу-ресурсу `httpServer()` (capability
`http-server-resource`). Разбор запроса, формирование ответа, лимиты тела
и отмена запросов в обработке SHALL принадлежать транспорту.

Пакет SHALL NOT реализовывать HTTP/2, WebSocket и TLS-терминацию. Эти
задачи SHALL решаться обратным прокси перед сервисом или отдельным
транспортом, а не расширением `@nestling/transport.http`.

#### Scenario: Транспорт объявляет свои формы io

- **WHEN** внешний код читает `capabilities` объявления `http()`
- **THEN** значение равно `{ input: {value, stream, multipart}, output:
  {value, stream, events} }`

#### Scenario: Сокет принадлежит серверу

- **WHEN** внешний код ищет, кто открывает и закрывает сокет
- **THEN** это сервер-ресурс: у транспорта нет ни `http.Server`, ни
  `listen`, ни `address()`

#### Scenario: HTTP/2, WebSocket и TLS остаются вне пакета

- **WHEN** приложению нужны HTTP/2, WebSocket или TLS-терминация
- **THEN** эти возможности предоставляет обратный прокси перед сервисом
  или отдельный транспорт, а не `@nestling/transport.http`
