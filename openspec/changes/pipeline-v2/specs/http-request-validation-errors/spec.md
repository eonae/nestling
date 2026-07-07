# http-request-validation-errors — delta

## MODIFIED Requirements

### Requirement: Schema validation failures keep 400

Ошибки zod-валидации payload SHALL приводить (как pre-юнитом `validate()`
в pipeline, так и в fallback-ветке транспорта без pipeline) к `400`
с деталями issue'ов — существующее поведение сохраняется в фазовой модели.

#### Scenario: Invalid field in fallback path (endpoint without pipeline)

- **WHEN** endpoint зарегистрирован без pipeline и payload не проходит схему
- **THEN** ответ имеет статус 400 (а не 500) с деталями валидации

#### Scenario: Invalid payload via validate() unit

- **WHEN** endpoint использует `makePipeline().pre(validate())` и payload
  не проходит схему
- **THEN** ответ имеет статус 400 с деталями issue'ов
