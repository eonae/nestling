# http-transport-limits Specification (delta)

## MODIFIED Requirements

### Requirement: Graceful close drains connections

Дренаж соединений SHALL принадлежать серверу (capability
`http-server-resource`), а отмена запросов в обработке — транспорту.

`drain()` сервера SHALL: перестать принимать новые соединения, немедленно
закрыть простаивающие keep-alive соединения, дождаться завершения активных
запросов до `closeTimeout` (дефолт 10s) и принудительно закрыть оставшиеся
соединения по его истечении. `drain()` SHALL завершаться за конечное время
при наличии живых keep-alive соединений. Опция `closeTimeout` SHALL
задаваться аргументом `httpServer()`.

`close()` транспорта SHALL взводить сигналы всех in-flight запросов (см.
capability `http-request-cancellation`) и SHALL NOT трогать сокет.
Кооперативное завершение по сигналу — основной механизм дренажа;
принудительное закрытие по `closeTimeout` — fallback для хендлеров,
игнорирующих сигнал.

#### Scenario: Close with idle keep-alive connection

- **WHEN** клиент держит открытое keep-alive соединение без активного запроса
  и приложение закрывается
- **THEN** дренаж завершается, не дожидаясь таймаута keep-alive клиента

#### Scenario: Close with hung in-flight request

- **WHEN** активный запрос не завершается дольше `closeTimeout`
  (хендлер игнорирует `meta.signal`)
- **THEN** по истечении `closeTimeout` соединение принудительно закрывается
  и дренаж завершается

#### Scenario: Close with cooperative in-flight request

- **WHEN** активный запрос обрабатывается хендлером, завершающимся
  по `meta.signal`, и приложение закрывается
- **THEN** дренаж завершается заметно раньше `closeTimeout`, без
  принудительного закрытия соединений
