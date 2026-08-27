# error-values

## MODIFIED Requirements

### Requirement: Словарь статусов покрывает конфликт, таймаут и ограничение частоты

`ErrorStatus` SHALL включать `CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS` и
`PAYLOAD_TOO_LARGE` наравне с существующими статусами. Статус SHALL
оставаться транспортно-нейтральной семантикой; перевод в код провода
SHALL быть заботой транспорта.

`@nestling/transport.http` SHALL отображать `CONFLICT → 409`,
`TOO_MANY_REQUESTS → 429`, `TIMEOUT → 504`, `PAYLOAD_TOO_LARGE → 413`.

#### Scenario: Конфликт больше не приходится выражать как BAD_REQUEST

- **WHEN** отказ объявлен со статусом `CONFLICT`
- **THEN** HTTP-ответ имеет код 409

#### Scenario: Таймаут операции

- **WHEN** отказ объявлен со статусом `TIMEOUT`
- **THEN** HTTP-ответ имеет код 504

#### Scenario: Ограничение частоты

- **WHEN** отказ объявлен со статусом `TOO_MANY_REQUESTS`
- **THEN** HTTP-ответ имеет код 429

#### Scenario: Превышение допустимого объёма входа

- **WHEN** отказ объявлен со статусом `PAYLOAD_TOO_LARGE` (в частности,
  отказ лимита item-цепочки `STREAM_LIMIT_EXCEEDED`)
- **THEN** HTTP-ответ имеет код 413
