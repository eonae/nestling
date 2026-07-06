# error-response-safety

## Purpose

Политика раскрытия деталей ошибок в ответах: generic 500 по умолчанию,
конфигурируемое раскрытие для разработки.

## Requirements

### Requirement: Internal error details are hidden by default

Тело ответа со статусом `INTERNAL_ERROR`/500 SHALL при необработанной ошибке
(не `Fail`) в pipeline или транспорте содержать только generic-сообщение
(`{ "error": "Internal server error" }`) и SHALL NOT содержать `error.message`,
`error.stack` или иные внутренние детали, если раскрытие явно не включено.

#### Scenario: Unhandled error with default options

- **WHEN** handler бросает `new Error('db password invalid')`, а транспорт
  создан без `exposeErrorDetails`
- **THEN** ответ имеет статус 500, тело равно `{ "error": "Internal server error" }`
  и не содержит ни `db password invalid`, ни поля `stack`

#### Scenario: Parsing-stage error with default options

- **WHEN** ошибка происходит до pipeline (например, внутренняя ошибка роутера),
  а транспорт создан без `exposeErrorDetails`
- **THEN** тело 500-ответа не содержит `error.message` и `stack` исходной ошибки

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

Ошибки, брошенные как `Fail`, SHALL сохранять текущее поведение: `message`
и `details` попадают в тело ответа независимо от `exposeErrorDetails` —
их раскрытие является осознанным решением автора кода.

#### Scenario: Fail.badRequest with default options

- **WHEN** handler бросает `Fail.badRequest('Email already taken', { field: 'email' })`
  без `exposeErrorDetails`
- **THEN** ответ 400 содержит `"error": "Email already taken"` и
  `details: { field: 'email' }`
