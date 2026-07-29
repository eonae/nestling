# http-request-validation-errors

## Purpose

Корректные HTTP-статусы для некорректного входа: битый JSON и конфликты ключей
источников payload → 400, а не 500.

## Requirements

### Requirement: Malformed JSON yields 400

Ошибка парсинга JSON-тела SHALL типизироваться (`JsonParseError`) и
транслироваться в ответ `400 Bad Request` с телом, указывающим на причину
(`{ "error": "Invalid JSON body" }`), а не в `500`.

#### Scenario: Broken JSON body

- **WHEN** на JSON-endpoint приходит тело `{"name": "Al` (обрезанный JSON)
- **THEN** ответ имеет статус 400, тело содержит `"Invalid JSON body"`
  и не содержит stack trace

### Requirement: Payload source key conflicts yield 400

Конфликт одноимённых ключей body/query/path-параметров SHALL типизироваться
(`PayloadConflictError` в `mergePayload`) и транслироваться
в `400 Bad Request` с указанием конфликтующего ключа.

#### Scenario: Duplicate key in body and query

- **WHEN** body содержит `{"id": 1}` и query-строка содержит `?id=2`
- **THEN** ответ имеет статус 400 и называет конфликтующий ключ `id`

### Requirement: Schema validation failures keep 400

Отказ валидации схемы SHALL приводить (как pre-юнитом `validate()`
в pipeline, так и в fallback-ветке транспорта без pipeline) к `400`
с деталями issue'ов — существующее поведение статуса сохраняется.
Детали SHALL иметь стандартизованную спекой Standard Schema форму:
`details` — массив объектов `{ message: string; path?: (string|number)[] }`;
вендор-специфичные поля (`code`, `expected`, `received` и подобные)
SHALL NOT попадать в тело ответа.

#### Scenario: Invalid field in fallback path (endpoint without pipeline)

- **WHEN** endpoint зарегистрирован без pipeline и payload не проходит схему
- **THEN** ответ имеет статус 400 (а не 500) с деталями валидации

#### Scenario: Invalid payload via validate() unit

- **WHEN** endpoint использует `makePipeline().pre(validate())` и payload
  не проходит схему
- **THEN** ответ имеет статус 400 с деталями issue'ов

#### Scenario: Форма details в теле ответа

- **WHEN** схема требует `name: string`, а приходит `{ "name": 42 }`
- **THEN** тело 400-ответа содержит `details` вида
  `[{ "message": "…", "path": ["name"] }]` и не содержит поля `code`

#### Scenario: Async-схема — не ошибка входа

- **WHEN** endpoint объявлен со схемой, чей `~standard.validate` возвращает
  Promise, и приходит корректный по форме payload
- **THEN** ответ имеет статус 500 (ошибка конфигурации приложения, а не
  входа), детали маскируются по политике `error-response-safety`

#### Scenario: Объект вместо схемы — не ошибка входа

- **WHEN** в `input` endpoint'а передан объект, не реализующий Standard
  Schema v1, и приходит запрос
- **THEN** ответ имеет статус 500, а не 400
