# http-transport-limits Specification (delta)

## MODIFIED Requirements

### Requirement: NDJSON line length is limited

Парсер NDJSON-стрима SHALL ограничивать длину одной строки значением
`maxBodySize`; превышение SHALL приводить к отказу `PayloadTooLarge`
(kernel-код `payload_too_large`, статус 413, если ответ ещё не начат).
То же ограничение SHALL действовать на строку любого другого потокового
входа.

Лимит срабатывает во время чтения потока, то есть уже внутри хендлера,
поэтому отказ SHALL нести код ядра: иначе проверка контракта отказов на
границе заменила бы его на `InternalError`. Статус SHALL NOT зависеть от
того, объявлен endpoint с `pipeline` или без.

Heartbeat-кадры SSE SHALL NOT участвовать в лимитах и SHALL NOT
учитываться как элементы потока.

#### Scenario: Oversized NDJSON line

- **WHEN** в streaming-input приходит одна строка длиннее `maxBodySize`
- **THEN** обработка прерывается ошибкой размера, а не ростом памяти

#### Scenario: Один статус на обоих видах деклараций

- **WHEN** строка длиннее лимита приходит endpoint'у с `pipeline` и
  endpoint'у без него
- **THEN** оба отвечают 413 с кодом `payload_too_large`

#### Scenario: Heartbeat не влияет на лимиты

- **WHEN** SSE-соединение живёт долго и получает много heartbeat-кадров
- **THEN** ни лимиты, ни счётчики элементов не изменяются
