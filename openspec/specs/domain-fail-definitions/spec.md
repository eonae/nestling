# domain-fail-definitions

## Purpose

Доменный отказ объявляется значением: `defineFail(code, { status, message,
details? })` возвращает определение, которое одновременно конструктор
отказа и предикат. Идентичность отказа — по `code`, а не по `instanceof`,
поэтому распознавание переживает границу процесса. Создание определения
не имеет побочных эффектов: оно влияет на приложение только через
`errors:` декларации. Тем же механизмом определены kernel-коды, входящие
в контракт любой ручки неявно.

## Requirements

### Requirement: `defineFail` создаёт доменный отказ как значение

`@nestling/pipeline` SHALL экспортировать `defineFail(code, { status,
message, details? })`, возвращающий **значение-определение**, которое
одновременно является конструктором отказа. Определение SHALL нести
`code`, `status`, схему `details` (если объявлена) и предикат `is`.

Определение SHALL создаваться без побочных эффектов: оно нигде не
регистрируется и влияет на приложение только через `errors:` декларации.

#### Scenario: Определение и конструирование отказа

- **WHEN** объявлено определение `OrderNotFound` с кодом `ORDER_NOT_FOUND`,
  статусом `NOT_FOUND`, схемой деталей `{ orderId: string }` и сообщением
  «Order {orderId} not found», и вызвано `OrderNotFound({ orderId: '42' })`
- **THEN** результат — `Fail` со `status === 'NOT_FOUND'`,
  `code === 'ORDER_NOT_FOUND'`, `details === { orderId: '42' }` и
  сообщением `Order 42 not found`

#### Scenario: Отказ без деталей

- **WHEN** определение объявлено без `details`, а `message` — строка
- **THEN** конструктор вызывается без аргументов (`EmailTaken()`) и даёт
  отказ с этим сообщением и без поля `details`

#### Scenario: Причина передаётся опциями

- **WHEN** вызвано `OrderNotFound({ orderId: '42' }, { cause: dbError })`
- **THEN** `fail.cause === dbError`

#### Scenario: Создание определения не имеет побочных эффектов

- **WHEN** модуль с определениями импортирован, но ни одно из них не
  указано в `errors:` какой-либо декларации
- **THEN** на поведение приложения это не влияет

### Requirement: Аргумент конструктора — `details`, сообщение выводится из него

Единственным источником данных отказа SHALL быть `details`: конструктор
SHALL принимать значение, выводимое из схемы `details`, а `message` SHALL
быть либо строкой, либо функцией **от этих деталей**. Произвольные
аргументы сообщения, не связанные со схемой, SHALL NOT поддерживаться.

`details` SHALL валидироваться схемой в конструкторе (синхронно, по
правилам capability `standard-schema-validation`); непрохождение схемы
SHALL быть ошибкой в точке создания отказа с указанием кода отказа.

#### Scenario: Тип аргумента выводится из схемы

- **WHEN** `details: z.object({ orderId: z.string() })`, а вызвано
  `OrderNotFound({ orderId: 42 })`
- **THEN** это ошибка компиляции

#### Scenario: Детали не проходят схему в рантайме

- **WHEN** JS-потребитель вызывает `OrderNotFound({})`
- **THEN** конструктор бросает ошибку, называющую код отказа и проблему
  валидации

#### Scenario: Сообщение — функция от деталей

- **WHEN** `message` объявлено функцией, читающей `d.orderId`
- **THEN** тип `d` выведен из схемы `details`, без аннотации

### Requirement: Идентичность отказа — по `code`, не по `instanceof`

Предикат `Definition.is(value)` SHALL распознавать отказ **по коду** и
SHALL сужать тип значения до отказа этого определения. Предикат SHALL
давать `true` для значения, потерявшего прототип (например, разобранного
из JSON), если его `code` и признак отказа сохранены.

`instanceof` SHALL NOT быть требуемым способом различения отказов ни в
одном месте публичного API.

#### Scenario: Матчинг в catch-юните

- **WHEN** `.catch`-юнит проверяет `if (OrderNotFound.is(res))`
- **THEN** ветка исполняется для отказа с кодом `ORDER_NOT_FOUND`,
  и внутри неё тип сужен (в том числе `details`)

#### Scenario: Отказ без прототипа

- **WHEN** проверяется объект, полученный
  `JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })))`
- **THEN** `OrderNotFound.is(value)` даёт `true`, тогда как
  `value instanceof Fail` — `false`

#### Scenario: Чужой код не проходит предикат

- **WHEN** проверяется отказ с кодом `CARD_DECLINED`
- **THEN** `OrderNotFound.is(value)` даёт `false`

### Requirement: Kernel-коды входят в контракт неявно

Ядро SHALL определять встроенные отказы тем же `defineFail` и
экспортировать их: `UnknownError` (код `UNKNOWN`, статус
`INTERNAL_ERROR`), `ValidationFailed` (код `VALIDATION_FAILED`, статус
`BAD_REQUEST`), `StreamLimitExceeded` (код `STREAM_LIMIT_EXCEEDED`,
статус `PAYLOAD_TOO_LARGE`) и `StreamGapTimeout` (код
`STREAM_GAP_TIMEOUT`, статус `TIMEOUT`). Эти коды SHALL считаться частью
множества допустимых ответов **любой** ручки без объявления в `errors:`.

Набор kernel-кодов SHALL быть закрытым: публичного способа пометить
пользовательский код встроенным SHALL NOT существовать. Набор SHALL
расти только вместе с ядром — вместе с механизмами, которые эти отказы
порождают (валидация, лимиты item-цепочек, в дальнейшем — deadline
портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** ручка объявляет `errors: [OrderLimitReached]` и её пайплайн
  использует `validate()`, а payload не проходит схему
- **THEN** ответ имеет статус 400 с кодом `VALIDATION_FAILED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Лимит потока остаётся 413

- **WHEN** ручка с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `STREAM_LIMIT_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `STREAM_GAP_TIMEOUT`

#### Scenario: UnknownError не требует объявления

- **WHEN** ручка не объявляет `errors:` вовсе
- **THEN** её ответом всё равно может быть `UNKNOWN`/500

#### Scenario: Пользовательский код не становится встроенным

- **WHEN** пользователь определяет отказ с кодом `UNKNOWN`
- **THEN** это не расширяет kernel-набор: собственный отказ подчиняется
  общему правилу и должен быть объявлен в `errors:`
