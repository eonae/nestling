# error-response-safety

## Purpose

Политика раскрытия деталей ошибок в ответах: generic 500 по умолчанию,
конфигурируемое раскрытие для разработки.

## Requirements

### Requirement: Internal error details are hidden by default

Тело ответа со статусом `internal_error`/500 SHALL при необработанной
ошибке (не `Fail`) или при нормализованном незадекларированном отказе в
pipeline или транспорте содержать только generic-документ
(`{"type":"urn:error:internal_error","title":"Internal Server Error","status":500,"detail":"Internal server error"}`)
и SHALL NOT содержать `error.message`, `stack` или иные внутренние
детали, если раскрытие явно не включено.

#### Scenario: Unhandled error with default options

- **WHEN** handler бросает `new Error('db password invalid')`, а транспорт
  создан без `exposeErrorDetails`
- **THEN** ответ имеет статус 500, тело содержит только
  `type: "urn:error:internal_error"`, `title`, `status` и
  `detail: "Internal server error"` и не содержит ни `db password invalid`,
  ни члена `stack`

#### Scenario: Parsing-stage error with default options

- **WHEN** ошибка происходит до pipeline (например, внутренняя ошибка
  роутера), а транспорт создан без `exposeErrorDetails`
- **THEN** тело 500-ответа не содержит сообщения исходной ошибки и члена
  `stack`

### Requirement: Error details can be exposed explicitly

Раскрытие деталей необработанных ошибок SHALL включаться опцией
`exposeErrorDetails: true` (опция транспорта, прокидывается в
`executeWithHandler`). При включении `detail` документа MAY содержать
сообщение исходной ошибки, а сам документ — расширение `stack`.

#### Scenario: Development mode opt-in

- **WHEN** `new HttpTransport({ exposeErrorDetails: true })` и handler бросает
  `new Error('boom')`
- **THEN** тело 500-ответа содержит `"detail": "boom"` и член `stack`

#### Scenario: CLI transport defaults to exposing details

- **WHEN** команда в `CliTransport` бросает необработанную ошибку
- **THEN** детали ошибки выводятся (CLI — локальный инструмент), поведение
  прежнее

### Requirement: Fail responses are not affected

Ошибки, брошенные или возвращённые как **задекларированный** `Fail`
(код входит в `errors:` endpoint'а или в набор kernel-кодов), SHALL
сохранять текущее поведение: сообщение, код и детали попадают в тело
ответа независимо от `exposeErrorDetails` — их раскрытие является
осознанным решением автора кода. В документе они занимают `detail`,
`type` и `details`. Шаги `.catch` пайплайна MAY заменить
`Fail`-ответ другим `Fail`-ответом (это тоже осознанное решение автора
endpoint'а); политика раскрытия необработанных ошибок при этом не
ослабляется.

**Незадекларированный** отказ привилегии раскрытия не имеет: он
нормализуется в `InternalError` (capability `endpoint-error-contract`) и
подчиняется политике необработанных ошибок — без `exposeErrorDetails`
клиент получает generic-документ, оригинал уходит в диагностический хук.

#### Scenario: Задекларированный отказ с default options

- **WHEN** endpoint объявляет `errors: [EmailTaken]`, хендлер бросает
  `EmailTaken({ email })`, `exposeErrorDetails` выключен
- **THEN** ответ 409 содержит `"type": "urn:error:conflict:email_taken"`,
  сообщение отказа в `detail` и его `details`

#### Scenario: Kernel-отказ с default options

- **WHEN** payload не проходит схему `input` при проверке рантаймом перед
  хендлером, а `exposeErrorDetails` выключен
- **THEN** ответ 400 содержит `"type": "urn:error:bad_request"` и детали
  issue'ов

#### Scenario: Незадекларированный Fail не раскрывается

- **WHEN** хендлер бросает `Fail.conflict('email already taken',
  { email })`, отказ не объявлен, `exposeErrorDetails` выключен
- **THEN** ответ — 500 с generic-документом
  (`type: "urn:error:internal_error"`, `detail: "Internal server error"`);
  ни сообщение, ни `details` оригинала в тело не попадают, а оригинал
  уходит в диагностический хук

#### Scenario: catch-шаг переоформляет Fail

- **WHEN** `.catch`-шаг заменяет `Fail`-ответ на другой **объявленный**
  `Fail` с изменённым телом
- **THEN** транспорту уходит заменённый ответ; необработанные (не `Fail`)
  ошибки по-прежнему маскируются generic-документом по умолчанию
