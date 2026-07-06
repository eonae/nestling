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

Ошибки zod-валидации payload SHALL приводить (как в pipeline через
`validate()`, так и в fallback-ветке транспорта без pipeline) к `400` с деталями
issue'ов — существующее поведение закрепляется спекой.

#### Scenario: Invalid field in fallback path (endpoint without pipeline)

- **WHEN** endpoint зарегистрирован без pipeline и payload не проходит схему
- **THEN** ответ имеет статус 400 (а не 500) с деталями валидации
