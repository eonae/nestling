# error-response-safety

## Purpose

Политика раскрытия деталей ошибок в ответах: generic 500 по умолчанию,
конфигурируемое раскрытие для разработки.

## Requirements

### Requirement: Internal error details are hidden by default

Тело ответа со статусом `INTERNAL_ERROR`/500 SHALL при необработанной
ошибке (не `Fail`) или при нормализованном незадекларированном отказе в
pipeline или транспорте содержать только generic-сообщение
(`{ "error": "Internal server error", "code": "UNKNOWN" }` для пути
pipeline) и SHALL NOT содержать `error.message`, `error.stack` или иные
внутренние детали, если раскрытие явно не включено.

#### Scenario: Unhandled error with default options

- **WHEN** handler бросает `new Error('db password invalid')`, а транспорт
  создан без `exposeErrorDetails`
- **THEN** ответ имеет статус 500, тело содержит только
  `error: "Internal server error"` и `code: "UNKNOWN"` и не содержит ни
  `db password invalid`, ни поля `stack`

#### Scenario: Parsing-stage error with default options

- **WHEN** ошибка происходит до pipeline (например, внутренняя ошибка
  роутера), а транспорт создан без `exposeErrorDetails`
- **THEN** тело 500-ответа не содержит `error.message` и `stack`
  исходной ошибки

### Requirement: Error details can be exposed explicitly

Раскрытие деталей необработанных ошибок SHALL включаться опцией
`exposeErrorDetails: true` (опция транспорта, прокидывается в
`executeWithHandler`). При включении тело `INTERNAL_ERROR` MAY содержать
`error.message` и `stack`.

#### Scenario: Development mode opt-in

- **WHEN** `new HttpTransport({ exposeErrorDetails: true })` и handler бросает
  `new Error('boom')`
- **THEN** тело 500-ответа содержит `"error": "boom"` и поле `stack`

#### Scenario: CLI transport defaults to exposing details

- **WHEN** команда в `CliTransport` бросает необработанную ошибку
- **THEN** детали ошибки выводятся (CLI — локальный инструмент), поведение
  прежнее

### Requirement: Fail responses are not affected

Ошибки, брошенные или возвращённые как **задекларированный** `Fail`
(код входит в `errors:` endpoint'а или в набор kernel-кодов), SHALL
сохранять текущее поведение: `message`, `code` и `details` попадают в тело
ответа независимо от `exposeErrorDetails` — их раскрытие является
осознанным решением автора кода. Юниты `.catch` пайплайна MAY заменить
`Fail`-ответ другим `Fail`-ответом (это тоже осознанное решение автора
endpoint'а); политика раскрытия необработанных ошибок при этом не
ослабляется.

**Незадекларированный** отказ привилегии раскрытия не имеет: он
нормализуется в `UnknownError` (capability `endpoint-error-contract`) и
подчиняется политике необработанных ошибок — без `exposeErrorDetails`
клиент получает generic-тело, оригинал уходит в диагностический хук.

#### Scenario: Задекларированный отказ с default options

- **WHEN** endpoint объявляет `errors: [EmailTaken]`, хендлер бросает
  `EmailTaken({ email })`, `exposeErrorDetails` выключен
- **THEN** ответ 409 содержит `"code": "EMAIL_TAKEN"`, сообщение отказа
  и его `details`

#### Scenario: Kernel-отказ с default options

- **WHEN** payload не проходит схему `input` при проверке рантаймом перед
  хендлером, а `exposeErrorDetails` выключен
- **THEN** ответ 400 содержит `"code": "VALIDATION_FAILED"` и детали
  issue'ов

#### Scenario: Незадекларированный Fail не раскрывается

- **WHEN** хендлер бросает `Fail.badRequest('email already taken',
  { email })`, отказ не объявлен, `exposeErrorDetails` выключен
- **THEN** ответ — 500 с телом `{ "error": "Internal server error",
  "code": "UNKNOWN" }`; ни сообщение, ни `details` оригинала в тело не
  попадают, а оригинал уходит в диагностический хук

#### Scenario: catch-юнит переоформляет Fail

- **WHEN** `.catch`-юнит заменяет `Fail`-ответ на другой **объявленный**
  `Fail` с изменённым телом
- **THEN** транспорту уходит заменённый ответ; необработанные (не `Fail`)
  ошибки по-прежнему маскируются generic-сообщением по умолчанию
