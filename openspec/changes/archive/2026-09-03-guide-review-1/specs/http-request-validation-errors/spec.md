# http-request-validation-errors Specification (delta)

## MODIFIED Requirements

### Requirement: Schema validation failures keep 400

Отказ валидации схемы SHALL приводить к `400` с деталями issue'ов у
любого endpoint'а со схемой `input`. Проверку выполняет рантайм пайплайна
перед хендлером (capability `endpoint-input-validation`); отдельной ветки
валидации в транспорте SHALL NOT быть, в том числе для полей формы
`multipart`. Детали SHALL иметь стандартизованную спекой Standard Schema
форму: `details` — массив объектов
`{ message: string; path?: (string|number)[] }`; вендор-специфичные поля
(`code`, `expected`, `received` и подобные) SHALL NOT попадать в элементы
`details`.

Отказ валидации SHALL нести kernel-код `bad_request` (capability
`domain-fail-definitions`): тело ответа SHALL содержать верхнеуровневое
поле `"code": "bad_request"`. Такой отказ SHALL проходить проверку
контракта отказов без нормализации и SHALL NOT требовать объявления в
`errors:` endpoint'а.

#### Scenario: Invalid field without pipeline

- **WHEN** endpoint зарегистрирован без pipeline и payload не проходит схему
- **THEN** ответ имеет статус 400 (а не 500) с деталями валидации и
  кодом `bad_request`

#### Scenario: Invalid payload with pipeline

- **WHEN** endpoint использует `makePipeline().pre(withRequestId())` и
  payload не проходит схему
- **THEN** ответ имеет статус 400 с деталями issue'ов и кодом
  `bad_request`, независимо от того, что объявлено в `errors:`

#### Scenario: Невалидные поля multipart

- **WHEN** endpoint объявлен с `input: multipart({ fields, files })`, и
  запрос несёт поля, не проходящие схему `fields`, и файл
- **THEN** ответ имеет статус 400 с кодом `bad_request`, файловый
  поток дочитан, соединение завершено штатно

#### Scenario: Форма details в теле ответа

- **WHEN** схема требует `name: string`, а приходит `{ "name": 42 }`
- **THEN** тело 400-ответа содержит `details` вида
  `[{ "message": "…", "path": ["name"] }]`, элементы `details` не содержат
  вендор-специфичного поля `code`, а верхнеуровневое поле `code` тела
  равно `"bad_request"`

#### Scenario: Async-схема — не ошибка входа

- **WHEN** endpoint объявлен со схемой, чей `~standard.validate` возвращает
  Promise, и приходит корректный по форме payload
- **THEN** ответ имеет статус 500 (ошибка конфигурации приложения, а не
  входа), детали маскируются по политике `error-response-safety`

#### Scenario: Объект вместо схемы — не ошибка входа

- **WHEN** в `input` endpoint'а передан объект, не реализующий Standard
  Schema v1, и приходит запрос
- **THEN** ответ имеет статус 500, а не 400
