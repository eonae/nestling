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
`BAD_REQUEST`), `PayloadTooLarge` (код `PAYLOAD_TOO_LARGE`, статус
`PAYLOAD_TOO_LARGE`, детали `{ limit }`),
`StreamLimitExceeded` (код `STREAM_LIMIT_EXCEEDED`,
статус `PAYLOAD_TOO_LARGE`), `StreamGapTimeout` (код
`STREAM_GAP_TIMEOUT`, статус `TIMEOUT`) и `DeadlineExceeded` (код
`DEADLINE_EXCEEDED`, статус `TIMEOUT`). Эти коды SHALL считаться частью
множества допустимых ответов **любого** endpoint'а без объявления в
`errors:`.

`DeadlineExceeded` SHALL определяться в `@nestling/pipeline` — там же, где
живёт закрытый набор и где его читает проверка контракта на границе, — и
SHALL реэкспортироваться из `@nestling/ports` для потребителей,
разбирающих результат вызова порта. Регистрации определения в наборе
**из другого пакета** SHALL NOT существовать: она означала бы
рантайм-мутацию закрытого множества.

Набор kernel-кодов SHALL быть закрытым: публичного способа пометить
пользовательский код встроенным SHALL NOT существовать. Набор SHALL
расти только вместе с ядром — вместе с механизмами, которые эти отказы
порождают (проверка входа, лимиты item-цепочек, бюджет вызова портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** endpoint объявляет `errors: [OrderLimitReached]`, а payload не
  проходит схему `input` при проверке рантаймом
- **THEN** ответ имеет статус 400 с кодом `VALIDATION_FAILED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Лимит размера входа остаётся 413

- **WHEN** одна строка потокового входа длиннее `maxBodySize`, и endpoint
  ничего не объявляет в `errors:`
- **THEN** ответ имеет статус 413 с кодом `PAYLOAD_TOO_LARGE`, а не
  нормализуется в `UNKNOWN`/500 — независимо от того, объявлен endpoint с
  `pipeline` или без

#### Scenario: Лимит потока остаётся 413

- **WHEN** endpoint с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `STREAM_LIMIT_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `STREAM_GAP_TIMEOUT`

#### Scenario: Исчерпанный бюджет остаётся 504

- **WHEN** реализация контракта не уложилась в бюджет вызова и ничего не
  объявляет в `errors:`
- **THEN** ответ имеет статус 504 с кодом `DEADLINE_EXCEEDED`, а не
  нормализуется в `UNKNOWN`/500

#### Scenario: UnknownError не требует объявления

- **WHEN** endpoint не объявляет `errors:` вовсе
- **THEN** его ответом всё равно может быть `UNKNOWN`/500

#### Scenario: Пользовательский код не становится встроенным

- **WHEN** автор пытается пометить своё определение `defineFail` как
  kernel-код
- **THEN** такого способа в публичной поверхности нет
