# endpoint-declarations Specification (delta)

## ADDED Requirements

### Requirement: Форма с `operation:` сверяет отказы пайплайна с операцией

В форме `httpEndpoint({ operation, pipeline, handler })` слот `pipeline`
SHALL принимать только пайплайн, все объявленные отказы которого (за
вычетом отказов ядра) входят в `errors:` операции. Иначе слот SHALL
принимать литерал `{ __error: …; undeclared: …; hint: … }` в форме
capability `pipeline-type-diagnostics`, и декларация SHALL NOT
компилироваться. Конструктор SHALL повторять проверку при создании
декларации и бросать ошибку, называющую операцию, слой и недостающие коды.

#### Scenario: Слой с отказом вне операции

- **WHEN** объявлено `httpEndpoint({ operation: GetUser, pipeline: authed, handler })`,
  где `authed` объявляет `Unauthorized`, а `GetUser` его не объявляет
- **THEN** это ошибка компиляции на слоте `pipeline` с подсказкой добавить
  `Unauthorized` в `errors:` операции; из JS — ошибка при создании
  декларации

#### Scenario: Слой согласован с операцией

- **WHEN** операция объявляет все отказы слоя
- **THEN** декларация компилируется, а её эффективное множество равно
  `errors:` операции
