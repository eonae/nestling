# http-transport-limits

## Purpose

Лимиты и таймауты HTTP-транспорта: размер тела запроса, таймауты сервера,
дренаж соединений при остановке.

## Requirements

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

Лимит размера файла SHALL браться из спецификации файлового поля
(`upload({ maxSize })`) декларации и применяться **во время** разбора,
без буферизации файла целиком. Поле без собственного `maxSize` SHALL
ограничиваться `maxBodySize` транспорта как значением по умолчанию.

При срабатывании лимита транспорт SHALL отвечать `413`, дренируя
оставшийся входной поток. Лимит `mime` из `upload({ mime })` SHALL
отвергать файл до чтения его тела ошибкой входа (`400`).

#### Scenario: Oversized file upload

- **WHEN** файл в поле, объявленном как `upload({ maxSize })`, превышает
  этот лимит
- **THEN** транспорт отвечает 413, соединение корректно завершается,
  файл не буферизуется целиком

#### Scenario: Поле без собственного лимита

- **WHEN** файловое поле объявлено как `upload()` без `maxSize`, а файл
  больше `maxBodySize`
- **THEN** транспорт отвечает 413

#### Scenario: Неверный MIME

- **WHEN** файл прислан с типом, не входящим в `upload({ mime })`
- **THEN** транспорт отвечает 400 без чтения тела файла

### Requirement: NDJSON line length is limited

Парсер NDJSON-стрима SHALL ограничивать длину одной строки значением
`maxBodySize`; превышение SHALL приводить к отказу `PayloadTooLarge`
(kernel-код `PAYLOAD_TOO_LARGE`, статус 413, если ответ ещё не начат).
То же ограничение SHALL действовать на строку любого другого потокового
входа.

Лимит срабатывает во время чтения потока, то есть уже внутри хендлера,
поэтому отказ SHALL нести код ядра: иначе проверка контракта отказов на
границе заменила бы его на `UnknownError`. Статус SHALL NOT зависеть от
того, объявлен endpoint с `pipeline` или без.

Heartbeat-кадры SSE SHALL NOT участвовать в лимитах и SHALL NOT
учитываться как элементы потока.

#### Scenario: Oversized NDJSON line

- **WHEN** в streaming-input приходит одна строка длиннее `maxBodySize`
- **THEN** обработка прерывается ошибкой размера, а не ростом памяти

#### Scenario: Один статус на обоих видах деклараций

- **WHEN** строка длиннее лимита приходит endpoint'у с `pipeline` и
  endpoint'у без него
- **THEN** оба отвечают 413 с кодом `PAYLOAD_TOO_LARGE`

#### Scenario: Heartbeat не влияет на лимиты

- **WHEN** SSE-соединение живёт долго и получает много heartbeat-кадров
- **THEN** ни лимиты, ни счётчики элементов не изменяются

### Requirement: Server timeouts are configurable

`HttpTransportOptions` SHALL поддерживать `requestTimeout`, `headersTimeout`,
`keepAliveTimeout`; значения SHALL применяться к `node:http`-серверу при
`listen()`. Дефолты Node сохраняются, если опции не заданы.

#### Scenario: Custom timeouts applied

- **WHEN** транспорт создан с `{ requestTimeout: 5000, headersTimeout: 2000, keepAliveTimeout: 1000 }`
- **THEN** после `listen()` у сервера `server.requestTimeout === 5000`,
  `server.headersTimeout === 2000`, `server.keepAliveTimeout === 1000`

### Requirement: Graceful close drains connections

`close()` SHALL: взвести сигналы всех in-flight запросов (см. capability
`http-request-cancellation`), перестать принимать новые соединения,
немедленно закрыть простаивающие keep-alive соединения, дождаться завершения
активных запросов до `closeTimeout` (дефолт 10s) и принудительно закрыть
оставшиеся соединения по его истечении. Кооперативное завершение по сигналу —
основной механизм дренажа; принудительное закрытие по `closeTimeout` —
fallback для хендлеров, игнорирующих сигнал. `close()` SHALL завершаться
за конечное время при наличии живых keep-alive соединений.

#### Scenario: Close with idle keep-alive connection

- **WHEN** клиент держит открытое keep-alive соединение без активного запроса
  и вызывается `close()`
- **THEN** `close()` завершается, не дожидаясь таймаута keep-alive клиента

#### Scenario: Close with hung in-flight request

- **WHEN** активный запрос не завершается дольше `closeTimeout`
  (хендлер игнорирует `meta.signal`)
- **THEN** по истечении `closeTimeout` соединение принудительно закрывается
  и `close()` завершается

#### Scenario: Close with cooperative in-flight request

- **WHEN** активный запрос обрабатывается хендлером, завершающимся
  по `meta.signal`, и вызывается `close()`
- **THEN** `close()` завершается дренажом заметно раньше `closeTimeout`,
  без принудительного закрытия соединений
