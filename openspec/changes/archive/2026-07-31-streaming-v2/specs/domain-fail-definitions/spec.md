# domain-fail-definitions

## MODIFIED Requirements

### Requirement: Kernel-коды входят в контракт неявно

Ядро SHALL определять встроенные отказы тем же `defineFail` и
экспортировать их: `UnknownError` (код `UNKNOWN`, статус
`INTERNAL_ERROR`), `ValidationFailed` (код `VALIDATION_FAILED`, статус
`BAD_REQUEST`), `StreamLimitExceeded` (код `STREAM_LIMIT_EXCEEDED`,
статус `PAYLOAD_TOO_LARGE`) и `StreamGapTimeout` (код
`STREAM_GAP_TIMEOUT`, статус `TIMEOUT`). Эти коды SHALL считаться частью
множества допустимых ответов **любой** ручки без объявления в `errors:`.

Набор kernel-кодов SHALL быть закрытым: публичного способа пометить
пользовательский код встроенным SHALL NOT существовать. Набор SHALL
расти только вместе с ядром — вместе с механизмами, которые эти отказы
порождают (валидация, лимиты item-цепочек, в дальнейшем — deadline
портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** ручка объявляет `errors: [OrderLimitReached]` и её пайплайн
  использует `validate()`, а payload не проходит схему
- **THEN** ответ имеет статус 400 с кодом `VALIDATION_FAILED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Лимит потока остаётся 413

- **WHEN** ручка с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `STREAM_LIMIT_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `STREAM_GAP_TIMEOUT`

#### Scenario: UnknownError не требует объявления

- **WHEN** ручка не объявляет `errors:` вовсе
- **THEN** её ответом всё равно может быть `UNKNOWN`/500

#### Scenario: Пользовательский код не становится встроенным

- **WHEN** пользователь определяет отказ с кодом `UNKNOWN`
- **THEN** это не расширяет kernel-набор: собственный отказ подчиняется
  общему правилу и должен быть объявлен в `errors:`
