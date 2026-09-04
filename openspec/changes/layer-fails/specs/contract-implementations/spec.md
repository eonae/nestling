# contract-implementations Specification (delta)

## ADDED Requirements

### Requirement: Отказы пайплайна реализации входят в `errors:` операции

`implement(Operation, { pipeline, handler })` SHALL принимать в слот
`pipeline` только пайплайн, все объявленные отказы которого (за вычетом
отказов ядра) входят в `errors:` операции; иначе слот SHALL принимать
литерал `{ __error: …; undeclared: …; hint: … }`, и реализация SHALL NOT
компилироваться. Для операций вида `event`, у которых `errors:` нет,
пайплайн с объявленными доменными отказами SHALL отвергаться тем же
способом. Рантайм SHALL повторять проверку при создании декларации.

#### Scenario: Реализация запроса со слоем вне контракта

- **WHEN** `implement(ClaimQuota, { pipeline: authed, handler })`, где
  `authed` объявляет `Unauthorized`, а `ClaimQuota` объявляет только
  `QuotaExceeded`
- **THEN** это ошибка компиляции с подсказкой добавить `Unauthorized` в
  `errors:` операции

#### Scenario: Подписчик события со слоем без доменных отказов

- **WHEN** `implement(UserRegistered, { subscriber: 'archive', pipeline: makePipeline().pre(TenantId.propagated()), handler })`
- **THEN** декларация компилируется: слой не объявляет отказов
