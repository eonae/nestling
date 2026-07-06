# http-transport-limits

## ADDED Requirements

### Requirement: Request body size is limited

HTTP-транспорт SHALL ограничивать размер буферизуемого тела запроса
(JSON, raw, text) значением `maxBodySize` (дефолт 1 MiB) и прерывать чтение
сразу при превышении, отвечая `413` с телом
`{ "error": "Payload too large" }`. Значение `0` SHALL отключать лимит.

#### Scenario: Oversized JSON body

- **WHEN** на JSON-endpoint приходит тело размером больше `maxBodySize`
- **THEN** транспорт отвечает 413, не буферизуя тело целиком

#### Scenario: Limit disabled explicitly

- **WHEN** транспорт создан с `maxBodySize: 0` и приходит тело 10 MiB
- **THEN** запрос обрабатывается без ошибки 413

### Requirement: Multipart file size is limited

Multipart-парсинг SHALL передавать `maxBodySize` в busboy как `limits.fileSize`
и при срабатывании лимита отвечать `413`, дренируя оставшийся входной поток.

#### Scenario: Oversized file upload

- **WHEN** в multipart-запросе файл превышает `maxBodySize`
- **THEN** транспорт отвечает 413, соединение корректно завершается

### Requirement: NDJSON line length is limited

Парсер NDJSON-стрима SHALL ограничивать длину одной строки значением
`maxBodySize`; превышение SHALL приводить к ошибке чанка (413, если ответ ещё
не начат).

#### Scenario: Oversized NDJSON line

- **WHEN** в streaming-input приходит одна строка длиннее `maxBodySize`
- **THEN** обработка прерывается ошибкой размера, а не ростом памяти

### Requirement: Server timeouts are configurable

`HttpTransportOptions` SHALL поддерживать `requestTimeout`, `headersTimeout`,
`keepAliveTimeout`; значения SHALL применяться к `node:http`-серверу при
`listen()`. Дефолты Node сохраняются, если опции не заданы.

#### Scenario: Custom timeouts applied

- **WHEN** транспорт создан с `{ requestTimeout: 5000, headersTimeout: 2000, keepAliveTimeout: 1000 }`
- **THEN** после `listen()` у сервера `server.requestTimeout === 5000`,
  `server.headersTimeout === 2000`, `server.keepAliveTimeout === 1000`

### Requirement: Graceful close drains connections

`close()` SHALL: перестать принимать новые соединения, немедленно закрыть
простаивающие keep-alive соединения, дождаться завершения активных запросов
до `closeTimeout` (дефолт 10s) и принудительно закрыть оставшиеся соединения
по его истечении. `close()` SHALL завершаться за конечное время при наличии
живых keep-alive соединений.

#### Scenario: Close with idle keep-alive connection

- **WHEN** клиент держит открытое keep-alive соединение без активного запроса
  и вызывается `close()`
- **THEN** `close()` завершается, не дожидаясь таймаута keep-alive клиента

#### Scenario: Close with hung in-flight request

- **WHEN** активный запрос не завершается дольше `closeTimeout`
- **THEN** по истечении `closeTimeout` соединение принудительно закрывается
  и `close()` завершается
