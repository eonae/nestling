# domain-fail-definitions Specification (delta)

## MODIFIED Requirements

### Requirement: `defineFail` создаёт доменный отказ как значение

`@nestling/operations` SHALL экспортировать `makeFail(code, { message?,
details? }?)`, возвращающий **значение-определение**, которое
одновременно является конструктором отказа. Определение SHALL нести
`code`, производную `category`, схему `details` (если объявлена) и
предикат `is`. Функции `defineFail` SHALL NOT существовать.

Код SHALL состоять из сегментов через двоеточие; каждый сегмент SHALL
соответствовать `[a-z_]+`. Первый сегмент SHALL быть категорией из
закрытого перечня: `bad_request`, `unauthorized`, `payment_required`,
`forbidden`, `not_found`, `conflict`, `payload_too_large`,
`too_many_requests`, `internal_error`, `not_implemented`,
`service_unavailable`, `timeout`. Остальные сегменты уточняют категорию и
свободны. Код из одной категории SHALL быть допустим.

Категория SHALL проверяться компилятором: тип кода —
`Category | \`${Category}:${string}\``. Формат сегментов SHALL проверяться
рантаймом в `makeFail`: сегмент вне `[a-z_]+` SHALL быть ошибкой,
называющей код и позицию сегмента. Отдельного поля `status` у определения и
у отказа SHALL NOT существовать.

Определение SHALL создаваться без побочных эффектов: оно нигде не
регистрируется и влияет на приложение только через `errors:` декларации.

#### Scenario: Определение и конструирование отказа

- **WHEN** объявлено определение `OrderNotFound` с кодом `not_found:order`,
  схемой деталей `{ orderId: string }` и сообщением «Order {orderId} not
  found», и вызвано `OrderNotFound({ orderId: '42' })`
- **THEN** результат — `Fail` с `code === 'not_found:order'`,
  `category === 'not_found'`, `details === { orderId: '42' }` и
  сообщением `Order 42 not found`

#### Scenario: Отказ без деталей

- **WHEN** определение объявлено без `details`, а `message` — строка
- **THEN** конструктор вызывается без аргументов (`EmailTaken()`) и даёт
  отказ с этим сообщением и без поля `details`

#### Scenario: Код из одной категории

- **WHEN** объявлено `makeFail('unauthorized')`
- **THEN** определение создано, `category === 'unauthorized'`, конструктор
  вызывается без аргументов

#### Scenario: Категория вне перечня

- **WHEN** написано `makeFail('gone:order')`
- **THEN** это ошибка компиляции: первый сегмент не из перечня категорий

#### Scenario: Сегмент вне алфавита

- **WHEN** JS-потребитель вызывает `makeFail('not_found:Order-42')`
- **THEN** `makeFail` бросает ошибку, называющую код и второй сегмент

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
Если `message` не задан, сообщением SHALL быть код отказа.

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

Предикат `Definition.is(value)` SHALL распознавать отказ **по полному
коду** и SHALL сужать тип значения до отказа этого определения. Предикат
SHALL давать `true` для значения, потерявшего прототип (например,
разобранного из JSON), если его `code` и признак отказа сохранены. Два
определения с одним кодом SHALL быть одним отказом по идентичности.

`instanceof` SHALL NOT быть требуемым способом различения отказов ни в
одном месте публичного API.

#### Scenario: Матчинг в catch-юните

- **WHEN** `.catch`-юнит проверяет `if (OrderNotFound.is(res))`
- **THEN** ветка исполняется для отказа с кодом `not_found:order`,
  и внутри неё тип сужен (в том числе `details`)

#### Scenario: Отказ без прототипа

- **WHEN** проверяется объект, полученный
  `JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })))`
- **THEN** `OrderNotFound.is(value)` даёт `true`, тогда как
  `value instanceof Fail` — `false`

#### Scenario: Чужой код не проходит предикат

- **WHEN** проверяется отказ с кодом `conflict:card_declined`
- **THEN** `OrderNotFound.is(value)` даёт `false`

#### Scenario: Категория не является идентичностью

- **WHEN** проверяется отказ с кодом `not_found:user`
- **THEN** `OrderNotFound.is(value)` даёт `false`, хотя категории совпадают

### Requirement: Kernel-коды входят в контракт неявно

Ядро SHALL определять встроенные отказы тем же `makeFail` и экспортировать
их из `@nestling/pipeline`: `BadRequest` (код `bad_request`, детали —
`issues` проверки входа), `PayloadTooLarge` (код `payload_too_large`,
детали `{ limit }`), `Timeout` (код `timeout`) и `InternalError` (код
`internal_error`). Код отказа ядра SHALL быть голой категорией без
уточнения. Определений `ValidationFailed`, `StreamLimitExceeded`,
`StreamGapTimeout`, `DeadlineExceeded` и `UnknownError` SHALL NOT
существовать.

Эти коды SHALL считаться частью множества допустимых ответов **любого**
endpoint'а без объявления в `errors:`. Пользовательское определение с тем
же кодом (`makeFail('bad_request')`) SHALL быть тем же отказом по
идентичности и SHALL проходить страж границы.

`Timeout` SHALL реэкспортироваться из `@nestling/ports` для потребителей,
разбирающих результат вызова порта. Регистрации определения в наборе
**из другого пакета** SHALL NOT существовать.

Набор отказов ядра SHALL быть закрытым и SHALL расти только вместе с
ядром — вместе с механизмами, которые эти отказы порождают (проверка
входа, лимиты входа и item-цепочек, бюджет вызова портов).

#### Scenario: Валидация входа остаётся 400

- **WHEN** endpoint объявляет `errors: [OrderLimitReached]`, а payload не
  проходит схему `input` при проверке рантаймом
- **THEN** ответ имеет статус 400 с кодом `bad_request`, а не
  нормализуется в `internal_error`/500

#### Scenario: Лимит размера входа остаётся 413

- **WHEN** одна строка потокового входа длиннее `maxBodySize`, и endpoint
  ничего не объявляет в `errors:`
- **THEN** ответ имеет статус 413 с кодом `payload_too_large`, а не
  нормализуется в `internal_error`/500 — независимо от того, объявлен
  endpoint с `pipeline` или без

#### Scenario: Лимит потока остаётся 413

- **WHEN** endpoint с `input: stream(T).limit(n)` получает больше `n`
  элементов и не объявляет ничего в `errors:`
- **THEN** ответ имеет статус 413 с кодом `payload_too_large`

#### Scenario: Таймаут молчания остаётся 504

- **WHEN** сработал `.gapTimeout(ms)` входной цепочки
- **THEN** ответ имеет статус 504 с кодом `timeout`

#### Scenario: Исчерпанный бюджет остаётся 504

- **WHEN** реализация операции не уложилась в бюджет вызова и ничего не
  объявляет в `errors:`
- **THEN** ответ имеет статус 504 с кодом `timeout`, а не нормализуется в
  `internal_error`/500

#### Scenario: InternalError не требует объявления

- **WHEN** endpoint не объявляет `errors:` вовсе
- **THEN** его ответом всё равно может быть `internal_error`/500

#### Scenario: Пользовательская категория проходит страж

- **WHEN** хендлер возвращает отказ определения `makeFail('bad_request')`,
  не перечисленного в `errors:`
- **THEN** ответ уходит клиенту как 400 с кодом `bad_request`, а не
  нормализуется в `internal_error`
