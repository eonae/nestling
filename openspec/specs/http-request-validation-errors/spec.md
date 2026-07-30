# http-request-validation-errors

## Purpose

Корректные HTTP-статусы для некорректного входа: битый JSON и поле,
присланное не в каноническое место, → 400, а не 500.

## Requirements

### Requirement: Malformed JSON yields 400

Ошибка парсинга JSON-тела SHALL типизироваться (`JsonParseError`) и
транслироваться в ответ `400 Bad Request` с телом, указывающим на причину
(`{ "error": "Invalid JSON body" }`), а не в `500`.

#### Scenario: Broken JSON body

- **WHEN** на JSON-endpoint приходит тело `{"name": "Al` (обрезанный JSON)
- **THEN** ответ имеет статус 400, тело содержит `"Invalid JSON body"`
  и не содержит stack trace

### Requirement: Поле не в каноническом месте даёт ошибку валидации, а не конфликт

Поле, присланное не в каноническое для него место (capability
`http-input-binding`), SHALL NOT попадать в payload. Если схема требует
это поле, запрос SHALL завершаться обычной ошибкой валидации —
`400 Bad Request` с деталями issue'ов, называющими отсутствующее поле.
Отдельного класса ошибок «конфликт источников payload» SHALL NOT
существовать: `PayloadConflictError` и функция слияния источников
`mergePayload` SHALL быть удалены из `@nestling/transport.http`.

#### Scenario: Обязательное поле прислано в query вместо тела

- **WHEN** у `POST /users` (поля по канону — в теле) приходит `?name=Alice`
  при пустом теле, а схема требует `name`
- **THEN** ответ имеет статус 400 с `details`, называющими `name`, и не
  упоминает конфликт источников

#### Scenario: Одноимённые path-параметр и поле тела не конфликтуют

- **WHEN** у `PATCH /users/:id` приходит путь `/users/42` и тело
  `{"id": "7"}`
- **THEN** запрос обрабатывается: `id` берётся из пути, ошибки 400 о
  дублирующемся ключе нет

#### Scenario: Класс ошибки конфликта недоступен

- **WHEN** код импортирует `PayloadConflictError` или `mergePayload` из
  `@nestling/transport.http`
- **THEN** импорт не резолвится (ошибка компиляции)

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
