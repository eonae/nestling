## MODIFIED Requirements

### Requirement: Форма с операцией требует вхождения отказов пайплайна в `errors:` операции

`httpEndpoint.implement(Operation, { pipeline })` и
`implement(Operation, { pipeline })` SHALL требовать, чтобы каждое определение из множества
объявленных отказов пайплайна (за вычетом отказов ядра) входило в
`errors:` операции. Нарушение SHALL быть ошибкой компиляции в точке
декларации: слот `pipeline` принимает литерал
`{ __error: …; undeclared: …; hint: … }`, где `hint` называет починку —
добавить определения в `errors:` операции. Ту же проверку SHALL выполнять
рантайм при создании декларации, а если для какой-то формы это
недостижимо — фаза ASSEMBLE; текст ошибки SHALL называть операцию,
слой и недостающие коды.

#### Scenario: Операция не объявляет отказ слоя

- **WHEN** операция `users.get` объявляет `errors: [UserNotFound]`, а
  реализация объявлена `httpEndpoint.implement(GetUser, { pipeline: authed })`,
  где `authed` объявляет `Unauthorized`
- **THEN** это ошибка компиляции на слоте `pipeline`, называющая
  `unauthorized` и предлагающая добавить `Unauthorized` в `errors:`
  операции; из JS — ошибка при создании декларации

#### Scenario: Операция объявляет отказ слоя

- **WHEN** операция `users.create` объявляет
  `errors: [EmailTaken, QuotaExceeded, Unauthorized]`, а реализация
  использует `pipeline: authed`
- **THEN** декларация компилируется и создаётся

#### Scenario: Реализация на шине

- **WHEN** `implement(SignupRecorded, { pipeline: scoped })`, где `scoped`
  объявляет отказ, которого нет в `errors:` команды
- **THEN** это ошибка компиляции, как у формы с операцией

#### Scenario: Отказы ядра не требуют объявления

- **WHEN** слой объявляет только определение ядра `BadRequest`
- **THEN** форма с операцией компилируется без `BadRequest` в `errors:`
  операции
