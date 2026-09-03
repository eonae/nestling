# endpoint-input-validation

## Purpose

Вход endpoint'а проверяет рантайм пайплайна — не юнит и не транспорт. Точка
проверки одна: после всех `.pre`-юнитов и до вызова хендлера, одинаково для
деклараций с полем `pipeline` и без него. Кандидат проверки — ключ `payload`
контекста, если его положил `.pre`-юнит, иначе `raw.payload`; что именно
проверяется, определяет форма io-декларации `input`. Отказ проверки —
`BadRequest` с ответом 400; он начинает ответную фазу наравне с отказом
`.pre`-юнита. Ошибка конфигурации схемы отказом входа не становится: она
остаётся ошибкой приложения и даёт 500. Юнита `validate()` в публичном API
нет — отказ от проверки выражается схемой, принимающей любое значение.

## Requirements

### Requirement: Рантайм проверяет вход по схеме `input` перед хендлером

Рантайм пайплайна SHALL проверять входные данные по схеме `input`
декларации у каждого endpoint'а, независимо от наличия поля `pipeline` и
состава его юнитов. Точка проверки SHALL быть одна: после всех
`.pre`-юнитов всех слоёв и до вызова хендлера. Хендлер SHALL получать
выход схемы (результат трансформаций), а не исходное значение.

Отказ проверки SHALL быть отказом `BadRequest` (`bad_request`,
`bad_request`) с `details` в форме стандартных `issues`. Он SHALL начинать
ответную фазу так же, как отказ `.pre`-юнита: `.catch`-юниты всех слоёв
применимы, проверка `errors:` пропускает kernel-код, `.finally` видит
ответ 400. Хендлер при этом SHALL NOT вызываться.

Отказ от проверки SHALL выражаться схемой, принимающей любое значение
(например `z.unknown()`). Отдельного флага декларации или пайплайна SHALL
NOT существовать.

#### Scenario: Пайплайн без специального юнита отвергает невалидный вход

- **WHEN** endpoint объявлен с `input: z.object({ n: z.number() })` и
  `pipeline: makePipeline().pre(withRequestId())`, и приходит payload
  `{ n: 'not-a-number' }`
- **THEN** ответ — `bad_request` с `code: 'bad_request'` и
  `details: [{ message, path: ['n'] }]`, хендлер не вызван

#### Scenario: Endpoint без пайплайна проверяется так же

- **WHEN** endpoint объявлен без поля `pipeline` с той же схемой, и
  приходит невалидный payload
- **THEN** ответ — тот же `bad_request` с `code: 'bad_request'`,
  полученный как `ResponseContext` из `dispatch.call`, а не как брошенное
  исключение

#### Scenario: Хендлер получает выход схемы

- **WHEN** схема `input` преобразует строку `'42'` в число, и приходит
  `{ id: '42' }`
- **THEN** хендлер получает `{ id: 42 }`

#### Scenario: Отказ `.pre`-юнита выполняется раньше проверки

- **WHEN** `.pre`-юнит авторизации бросает отказ `unauthorized`, а payload
  невалиден
- **THEN** ответ — `unauthorized`, схема не вызывалась

#### Scenario: Наблюдатели видят отказ проверки

- **WHEN** у endpoint'а пайплайн `compose(outer, inner)` с `.catch` и
  `.finally` в обоих слоях, и приходит невалидный payload
- **THEN** `.catch` и `.finally` обоих слоёв вызваны с ответом 400, исход
  `failed`, хук `onUnknownFail` не вызван

#### Scenario: Схема, принимающая всё, отключает проверку

- **WHEN** endpoint объявлен с `input: z.unknown()`
- **THEN** любой payload доходит до хендлера без изменений

### Requirement: Кандидат проверки — ключ `payload` контекста или `raw.payload`

Рантайм SHALL проверять значение `ctx.input.payload`, если какой-либо
`.pre`-юнит положил ключ `payload` в контекст, иначе — `ctx.raw.payload`.
Ключ `payload` SHALL оставаться зарезервированным: в `meta` хендлера он
SHALL NOT попадать ни в типах, ни в рантайме. Проверенное значение SHALL
передаваться хендлеру аргументом `payload` и SHALL NOT записываться в
`ctx.input` или в проекцию контекста запроса.

#### Scenario: `.pre`-юнит подменяет кандидата

- **WHEN** `.pre`-юнит возвращает `{ payload: envelope.params }`, распаковав
  конверт из `raw.payload`, а схема `input` описывает `params`
- **THEN** проверяется распакованное значение, хендлер получает его выход
  схемы, в `meta` ключа `payload` нет

#### Scenario: Без подмены проверяется `raw.payload`

- **WHEN** ни один `.pre`-юнит не кладёт `payload`
- **THEN** проверяется `ctx.raw.payload`, собранный транспортом

#### Scenario: Проверенное значение не попадает в проекцию контекста

- **WHEN** хендлер вызывает сервис с `Ctx`-ридером
- **THEN** проекция не содержит ключа `payload`

### Requirement: Форма `input` определяет, что проверяется

Проверка SHALL зависеть от формы io-декларации:

- форма значения со схемой-листом: кандидат проверяется целиком;
- форма значения с листом `binary` или `text`, а также отсутствие `input`:
  кандидат передаётся хендлеру как есть;
- `multipart({ fields, files })`: `fields` проверяются схемой `fields`,
  если она объявлена, `files` передаются без изменений; кандидат, не
  являющийся объектом, SHALL давать отказ проверки;
- `stream(T)` и `events(T)`: кандидат передаётся как есть, элементы
  проверяются по одному при чтении (capability `io-forms`).

Проверка полей `multipart` SHALL выполняться рантаймом, а не транспортом,
и SHALL быть одинаковой для HTTP-запроса и для `testApp.call`.

#### Scenario: Поля `multipart` проверяются рантаймом

- **WHEN** endpoint объявлен с
  `input: multipart({ fields: z.object({ title: z.string().min(1) }), files: { avatar: upload() } })`,
  и HTTP-запрос несёт пустое поле `title` и файл
- **THEN** ответ 400 с `code: 'bad_request'`, файловый поток дочитан
  транспортом, соединение завершено штатно

#### Scenario: `testApp.call` проверяет поля `multipart`

- **WHEN** тест вызывает
  `testApp.call(UploadAvatar, { fields: { title: '' }, files: { avatar } })`
- **THEN** ответ — `bad_request`, хендлер не вызван

#### Scenario: Файлы не трогаются

- **WHEN** `fields` валидны
- **THEN** хендлер получает `{ fields: <выход схемы>, files }`, где
  `files` — тот же объект, что собрал транспорт

#### Scenario: Примитивный лист и отсутствие `input`

- **WHEN** endpoint объявлен с `input: 'binary'` или без `input`
- **THEN** хендлер получает `raw.payload` без изменений

#### Scenario: Потоковый вход не проверяется целиком

- **WHEN** endpoint объявлен с `input: stream(Row)`
- **THEN** хендлер получает тот же итератор, что положил транспорт;
  невалидный элемент даёт отказ при чтении, как и раньше

### Requirement: Ошибка конфигурации схемы — ошибка приложения, а не входа

Если `~standard.validate` схемы `input` возвращает Promise
(`AsyncSchemaNotSupportedError`) или объект в `input` не реализует
Standard Schema v1 (`NotAStandardSchemaError`), рантайм SHALL NOT
превращать это в отказ 400. Ошибка SHALL обрабатываться как
необработанная: ответ `internal_error`, нормализованный в `InternalError`,
оригинал передаётся хуку `onUnknownFail`. Поведение SHALL быть одинаковым
для endpoint'ов с пайплайном и без.

#### Scenario: Async-схема без пайплайна

- **WHEN** endpoint без `pipeline` объявлен со схемой, чей `validate`
  возвращает Promise, и приходит запрос
- **THEN** ответ 500 с `code: 'internal_error'`, хук `onUnknownFail` получил
  `AsyncSchemaNotSupportedError`

#### Scenario: Объект-не-схема с пайплайном

- **WHEN** endpoint с пайплайном объявлен с `input: { parse() {} }`
- **THEN** ответ 500, а не 400

### Requirement: Юнита `validate()` в публичном API нет

Пакет `@nestling/pipeline` SHALL NOT экспортировать юнит `validate()`.
Сигнатура `Pipeline.executeWithHandler` SHALL типизировать аргумент
`payload` хендлера как `unknown`; тип `meta` SHALL по-прежнему исключать
ключ `payload`.

#### Scenario: Импорт не компилируется

- **WHEN** код импортирует `validate` из `@nestling/pipeline`
- **THEN** импорт не резолвится (ошибка компиляции)

#### Scenario: Пользовательский `payload` не попадает в мету

- **WHEN** пайплайн содержит `.pre`-юнит, возвращающий
  `{ payload: unknown }`
- **THEN** тип `meta` в `executeWithHandler` не содержит ключа `payload`,
  а `payload` типизирован как `unknown`
