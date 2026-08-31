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

Отказ валидации SHALL нести kernel-код `VALIDATION_FAILED` (capability
`domain-fail-definitions`): тело ответа SHALL содержать верхнеуровневое
поле `"code": "VALIDATION_FAILED"`. Такой отказ SHALL проходить проверку
контракта отказов без нормализации и SHALL NOT требовать объявления в
`errors:` endpoint'а.

#### Scenario: Invalid field without pipeline

- **WHEN** endpoint зарегистрирован без pipeline и payload не проходит схему
- **THEN** ответ имеет статус 400 (а не 500) с деталями валидации и
  кодом `VALIDATION_FAILED`

#### Scenario: Invalid payload with pipeline

- **WHEN** endpoint использует `makePipeline().pre(withRequestId())` и
  payload не проходит схему
- **THEN** ответ имеет статус 400 с деталями issue'ов и кодом
  `VALIDATION_FAILED`, независимо от того, что объявлено в `errors:`

#### Scenario: Невалидные поля multipart

- **WHEN** endpoint объявлен с `input: multipart({ fields, files })`, и
  запрос несёт поля, не проходящие схему `fields`, и файл
- **THEN** ответ имеет статус 400 с кодом `VALIDATION_FAILED`, файловый
  поток дочитан, соединение завершено штатно

#### Scenario: Форма details в теле ответа

- **WHEN** схема требует `name: string`, а приходит `{ "name": 42 }`
- **THEN** тело 400-ответа содержит `details` вида
  `[{ "message": "…", "path": ["name"] }]`, элементы `details` не содержат
  вендор-специфичного поля `code`, а верхнеуровневое поле `code` тела
  равно `"VALIDATION_FAILED"`

#### Scenario: Async-схема — не ошибка входа

- **WHEN** endpoint объявлен со схемой, чей `~standard.validate` возвращает
  Promise, и приходит корректный по форме payload
- **THEN** ответ имеет статус 500 (ошибка конфигурации приложения, а не
  входа), детали маскируются по политике `error-response-safety`

#### Scenario: Объект вместо схемы — не ошибка входа

- **WHEN** в `input` endpoint'а передан объект, не реализующий Standard
  Schema v1, и приходит запрос
- **THEN** ответ имеет статус 500, а не 400
