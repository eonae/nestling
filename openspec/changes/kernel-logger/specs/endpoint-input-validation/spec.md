## MODIFIED Requirements

### Requirement: Рантайм проверяет вход по схеме `input` перед хендлером

Рантайм пайплайна SHALL проверять входные данные по схеме `input`
декларации у каждого endpoint'а, независимо от наличия поля `pipeline` и
состава его юнитов. Точка проверки SHALL быть одна: после всех
`.pre`-юнитов всех слоёв и до вызова хендлера. Хендлер SHALL получать
выход схемы (результат трансформаций), а не исходное значение.

Отказ проверки SHALL быть отказом `BadRequest` (`bad_request`) с
`details` в форме стандартных `issues`. Он SHALL начинать ответную фазу
так же, как отказ `.pre`-юнита: `.catch`-юниты всех слоёв применимы,
проверка `errors:` пропускает kernel-код, `.finally` видит ответ 400.
Хендлер при этом SHALL NOT вызываться.

Отказ от проверки SHALL выражаться схемой, принимающей любое значение
(например `z.unknown()`). Отдельного флага декларации или пайплайна SHALL
NOT существовать.

#### Scenario: Пайплайн без специального юнита отвергает невалидный вход

- **WHEN** endpoint объявлен с `input: z.object({ n: z.number() })` и
  `pipeline: makePipeline().pre(withRequestId())`, и приходит payload
  `{ n: 'not-a-number' }`
- **THEN** ответ имеет код `bad_request` и
  `details: [{ message, path: ['n'] }]`, хендлер не вызван

#### Scenario: Endpoint без пайплайна проверяется так же

- **WHEN** endpoint объявлен без поля `pipeline` с той же схемой, и
  приходит невалидный payload
- **THEN** ответ — тот же отказ `bad_request`,
  полученный как `ResponseContext` из `dispatch.call`, а не как брошенное
  исключение

#### Scenario: Хендлер получает выход схемы

- **WHEN** схема `input` преобразует строку `'42'` в число, и приходит
  `{ id: '42' }`
- **THEN** хендлер получает `{ id: 42 }`

#### Scenario: Отказ `.pre`-юнита выполняется раньше проверки

- **WHEN** `.pre`-юнит авторизации бросает отказ с кодом `unauthorized`, а
  payload невалиден
- **THEN** ответ — `unauthorized`, схема не вызывалась

#### Scenario: Наблюдатели видят отказ проверки

- **WHEN** у endpoint'а пайплайн `compose(outer, inner)` с `.catch` и
  `.finally` в обоих слоях, и приходит невалидный payload
- **THEN** `.catch` и `.finally` обоих слоёв вызваны с ответом 400, исход
  `failed`, записи `error` о незадекларированном отказе в логгере нет

#### Scenario: Схема, принимающая всё, отключает проверку

- **WHEN** endpoint объявлен с `input: z.unknown()`
- **THEN** любой payload доходит до хендлера без изменений

### Requirement: Ошибка конфигурации схемы — ошибка приложения, а не входа

Если `~standard.validate` схемы `input` возвращает Promise
(`AsyncSchemaNotSupportedError`) или объект в `input` не реализует
Standard Schema v1 (`NotAStandardSchemaError`), рантайм SHALL NOT
превращать это в отказ 400. Ошибка SHALL обрабатываться как
необработанная: ответ с кодом `internal_error`, нормализованным в
`InternalError`, оригинал записывается уровнем `error` в логгер
`dispatch`. Поведение SHALL быть одинаковым для endpoint'ов с пайплайном
и без.

#### Scenario: Async-схема без пайплайна

- **WHEN** endpoint без `pipeline` объявлен со схемой, чей `validate`
  возвращает Promise, и приходит запрос
- **THEN** ответ 500 с `code: 'internal_error'`, а запись `error` в
  логгере несёт `AsyncSchemaNotSupportedError` в `err`

#### Scenario: Объект-не-схема с пайплайном

- **WHEN** endpoint с пайплайном объявлен с `input: { parse() {} }`
- **THEN** ответ 500, а не 400
