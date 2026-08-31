## MODIFIED Requirements

### Requirement: Kernel-коды входят в контракт неявно

Ядро SHALL определять встроенные отказы тем же `defineFail` и
экспортировать их: `UnknownError` (код `UNKNOWN`, статус
`INTERNAL_ERROR`), `ValidationFailed` (код `VALIDATION_FAILED`, статус
`BAD_REQUEST`), `PayloadTooLarge` (код `PAYLOAD_TOO_LARGE`, статус
`PAYLOAD_TOO_LARGE`, детали `{ limit }`),
`StreamLimitExceeded` (код `STREAM_LIMIT_EXCEEDED`,
статус `PAYLOAD_TOO_LARGE`), `StreamGapTimeout` (код
`STREAM_GAP_TIMEOUT`, статус `TIMEOUT`) и `DeadlineExceeded` (код
`DEADLINE_EXCEEDED`, статус `TIMEOUT`). Эти коды SHALL считаться частью
множества допустимых ответов **любого** endpoint'а без объявления в
`errors:`.

`DeadlineExceeded` SHALL определяться в `@nestling/pipeline` — там же, где
живёт закрытый набор и где его читает проверка контракта на границе, — и
SHALL реэкспортироваться из `@nestling/ports` для потребителей,
разбирающих результат вызова порта. Регистрации определения в наборе
**из другого пакета** SHALL NOT существовать: она означала бы
рантайм-мутацию закрытого множества.

Набор kernel-кодов SHALL быть закрытым: публичного способа пометить
пользовательский код встроенным SHALL NOT существовать. Набор SHALL
расти только вместе с ядром — вместе с механизмами, которые эти отказы
порождают (проверка входа, лимиты item-цепочек, бюджет вызова портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** endpoint объявляет `errors: [OrderLimitReached]`, а payload не
  проходит схему `input` при проверке рантаймом
- **THEN** ответ имеет статус 400 с кодом `VALIDATION_FAILED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Лимит размера входа остаётся 413

- **WHEN** одна строка потокового входа длиннее `maxBodySize`, и endpoint
  ничего не объявляет в `errors:`
- **THEN** ответ имеет статус 413 с кодом `PAYLOAD_TOO_LARGE`, а не
  нормализуется в `UNKNOWN`/500 — независимо от того, объявлен endpoint с
  `pipeline` или без

#### Scenario: Лимит потока остаётся 413

- **WHEN** endpoint с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `STREAM_LIMIT_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `STREAM_GAP_TIMEOUT`

#### Scenario: Исчерпанный бюджет остаётся 504

- **WHEN** реализация контракта не уложилась в бюджет вызова и ничего не
  объявляет в `errors:`
- **THEN** ответ имеет статус 504 с кодом `DEADLINE_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: UnknownError не требует объявления

- **WHEN** endpoint не объявляет `errors:` вовсе
- **THEN** его ответом всё равно может быть `UNKNOWN`/500

#### Scenario: Пользовательский код не становится встроенным

- **WHEN** автор пытается пометить своё определение `defineFail` как
  kernel-код
- **THEN** такого способа в публичной поверхности нет
