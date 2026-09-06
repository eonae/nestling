## MODIFIED Requirements

### Requirement: Kernel-коды входят в контракт неявно

Ядро SHALL определять встроенные отказы тем же `makeFail` и экспортировать
их из `@nestling/app`: `BadRequest` (код `bad_request`, детали —
`issues` проверки входа), `PayloadTooLarge` (код `payload_too_large`,
детали `{ limit }`), `Timeout` (код `timeout`) и `InternalError` (код
`internal_error`). Код отказа ядра SHALL быть голой категорией без
уточнения. Определений `ValidationFailed`, `StreamLimitExceeded`,
`StreamGapTimeout`, `DeadlineExceeded` и `UnknownError` SHALL NOT
существовать.

Эти коды SHALL считаться частью множества допустимых ответов **любого**
endpoint'а без объявления в `errors:`. Пользовательское определение с тем
же кодом (`makeFail('bad_request')`) SHALL быть тем же отказом по
идентичности и SHALL проходить страж границы.

`Timeout` SHALL реэкспортироваться из `@nestling/app` для потребителей,
разбирающих результат вызова порта. Регистрации определения в наборе
**из другого пакета** SHALL NOT существовать.

Набор отказов ядра SHALL быть закрытым и SHALL расти только вместе с
ядром — вместе с механизмами, которые эти отказы порождают (проверка
входа, лимиты входа и item-цепочек, бюджет вызова портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** endpoint объявляет `errors: [OrderLimitReached]`, а payload не
  проходит схему `input` при проверке рантаймом
- **THEN** ответ имеет статус 400 с кодом `bad_request`, а не
  нормализуется в `internal_error`/500

#### Scenario: Лимит размера входа остаётся 413

- **WHEN** одна строка потокового входа длиннее `maxBodySize`, и endpoint
  ничего не объявляет в `errors:`
- **THEN** ответ имеет статус 413 с кодом `payload_too_large`, а не
  нормализуется в `internal_error`/500 — независимо от того, объявлен
  endpoint с `pipeline` или без

#### Scenario: Лимит потока остаётся 413

- **WHEN** endpoint с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `payload_too_large`

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `timeout`

#### Scenario: Исчерпанный бюджет остаётся 504

- **WHEN** реализация операции не уложилась в бюджет вызова и ничего не
  объявляет в `errors:`
- **THEN** ответ имеет статус 504 с кодом `timeout`, а не нормализуется в
  `internal_error`/500

#### Scenario: InternalError не требует объявления

- **WHEN** endpoint не объявляет `errors:` вовсе
- **THEN** его ответом всё равно может быть `internal_error`/500

#### Scenario: Пользовательская категория проходит страж

- **WHEN** хендлер возвращает отказ определения `makeFail('bad_request')`,
  не перечисленного в `errors:`
- **THEN** ответ уходит клиенту как 400 с кодом `bad_request`, а не
  нормализуется в `internal_error`
