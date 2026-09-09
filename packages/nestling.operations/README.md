# @nestling/operations

Декларации, общие для сервера и клиента, и примитивы потоков:
`makeRequest` / `makeCommand` / `makeEvent`, `makeFail` со встроенными
кодами отказов, `Ok`/`Fail` и перечень статусов, формы io
(`stream()`, `events()`, `multipart()`/`upload()`), пометки размещения
`query()`/`body()` и HTTP bind-карта, секция документации `doc:`,
аннотация `jsonSchema()`, а также `Topic<T>`, комбинаторы item-цепочек и
помощники итерации под `AbortSignal`.

> 🚧 Пакет в активной разработке, API может меняться. Целевой дизайн —
> [`docs/design/operations.md`](../../docs/design/operations.md) и
> [`docs/design/streaming.md`](../../docs/design/streaming.md), гайд —
> [глава 12. Отдать фронтенду документацию и клиент](../../docs/guide/12-openapi-and-client.md).

## Без серверного кода

В графе импортов пакета нет серверного кода: ни композиционного корня, ни
пайплайна, ни транспортов, ни конфига (всё это — `@nestling/app`), ни
модулей `node:*`. Единственная внешняя зависимость — типы
`@standard-schema/spec`. Примитив DI-токена приходит через subpath
`@nestling/container/tokens`: это два модуля без рантайм-импортов.

Поэтому операцию можно импортировать во фронтенд-бандл. Это проверяет тест
`src/boundary.spec.ts`: он обходит граф импортов собранного `dist/` и
падает, называя модуль и запрещённый импорт.

## Установка

```bash
npm install @nestling/operations
```

## Минимальный пример

```typescript
import { makeFail, makeRequest, query } from '@nestling/operations';

export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const CreateUser = makeRequest({
  name: 'users.create',                                   // subject шины
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
  doc: { summary: 'Create user', tags: ['users'], status: 'created' },
});
```

Операция — значение. Она ничего не регистрирует в модуле или приложении.
В приложение он попадает двумя способами: кто-то его реализует
(`implement` из `@nestling/app`) и кто-то инжектит его вызыватель
(`CreateUser.caller`).

## Операция

`makeRequest(spec)` принимает словарь:

| Поле | Значение |
|---|---|
| `name` | имя и адрес операции: subject шины и ключ discovery. Версия входит в имя (`users.create.v2`), отдельного поля версии нет |
| `kind` | `'request'`, `'command'` или `'event'` |
| `input`, `output` | формы io (см. ниже). У `command` и `event` `output` в доставке не участвует |
| `errors` | список определений `makeFail` |
| `doc` | документация операции (см. «Секция `doc:`») |
| `durable` | долговечная доставка; допустима только у `command` и `event` |
| `http` | HTTP-адрес: строка `'POST /users/:id'` или запись `{ method, path, bind?, rawBody?, sse? }` |

| Вид | Семантика | Владельцев | Вызыватель |
|---|---|---|---|
| `request` | запрос-ответ, возвращает `Ok` или `Fail` | ровно один | `.caller` — `call(input, meta?)` |
| `command` | без ответа | ровно один | `.emitter` — `emit(payload, meta?)` |
| `event` | факт для подписчиков | 0..N подписчиков | `.emitter` — `emit(payload, meta?)` |

Свойство `.caller` есть только у `request`, `.emitter` — только у `command` и
`event`. Обращение к отсутствующему свойству не компилируется.

Словарь проверяется при создании: пустое имя, неизвестный `kind`, элемент
`errors` не из `makeFail`, повторяющийся код отказа, `durable` у
`request` и дубликат имени операции — ошибка сразу.

Типы для работы с операцией: `Operation`, `RequestOperation`,
`CommandOperation`, `EventOperation`, `InputOf<C>`, `OutputOf<C>`,
`OperationFailsOf<C>`, `Port<C>`, `Emitter<C>`, `PortResult<C>`.

### `meta` вызова

| Поле | Где | Значение |
|---|---|---|
| `signal` | все виды | отмена вызова; становится `meta.signal` обработчика |
| `deadline` | все виды | бюджет вызова как момент времени (`Date`); по истечении — отказ `timeout` |
| `idempotencyKey` | только `command` | ключ идемпотентности; если не задан, вызыватель создаёт свой |

Типы: `PortMeta`, `CommandMeta`, `MetaOf<C>`.

## Результат: `Ok` и `Fail`

Ответ операции — `Ok<T>` или `Fail`. Оба различаются полем `isFail`,
которое переживает сериализацию, в отличие от `instanceof`.

```typescript
new Ok(value);                           // статус OK
new Ok('created', value);                // явный успешный статус
Ok.created(value); Ok.accepted(value); Ok.noContent();

new Fail('conflict:email_taken', 'Email taken', { details?, cause? });
Fail.notFound('Order 42 not found');     // анонимный отказ: код равен категории
```

`Fail` расширяет `Error`, поэтому его можно и вернуть, и бросить.
Канон — `return`: возвращённый отказ виден в типе `Output` хендлера, а
`throw` доставляет отказ из глубины вызовов. Идентичность отказа
определяется полем `code`, а не классом. Анонимные отказы
(`Fail.badRequest(...)` и другие фабрики) несут код, равный категории; в
`errors:` их обычно нет, и на выходе из пайплайна такой отказ заменяется
на `InternalError`.

Заголовков `Ok` не несёт: `Location` и `Set-Cookie` осмысленны только в
HTTP, а хендлер операции переносим между транспортами. Их задаёт форма
ответа своего транспорта — `HttpResponse` из
[`@nestling/transport.http`](../nestling.transport.http). Статусы успеха
от транспорта не зависят и остаются у обеих форм хендлера.

`TransportResponse<T>` — протокол такой формы: метка
`Symbol.for('nestling:transport-response')`, имя транспорта `transport`,
метаданные протокола `meta` и результат `result`. Ядро `meta` не читает,
а транспорт читает, только если имя совпало с его собственным; иначе
отвечает `internal_error`. Предикат — `isTransportResponse(value)`.
В `OutputSync` конверт не входит: хендлер, не знающий транспорта, вернуть
его не может.

`Output<T, E>` и `OutputSync<T, E>` — типы возврата хендлера: `Ok<T>`,
голое `T`, отказ из `E` или отказ ядра. Множество `E` записывается
определениями: `Output<User, typeof UserNotFound | typeof EmailTaken>`.
Без `errors` `E` пуст, и вернуть доменный отказ нельзя.

Отказы ядра (`BadRequest`, `PayloadTooLarge`, `Timeout`, `InternalError`)
входят в возврат без объявления: граница пропускает их у любого
endpoint'а, и правило типов повторяет правило границы. Поэтому результат
вызова порта пробрасывается из хендлера как есть, без приведения типов.
Их объединение экспортируется типом `KernelFail`.

У декларации без `output` тип значения — `void`: хендлер компилируется
без `return`. `Ok.noContent()` и `new Ok(null)` там тоже допустимы —
`Ok<null>` входит в возврат ровно у такой декларации, а у декларации со
схемой остаётся ошибкой.

`successStatuses` и `categories` — перечни статусов успеха и категорий
отказа, `statuses` — их объединение; `SuccessStatus`, `Category`,
`ProcessingStatus` — типы. Ни статус, ни категория не зависят от
транспорта: в HTTP-код или код шины их переводит транспорт.

## Отказы: `makeFail`

```typescript
export const OrderNotFound = makeFail('not_found:order', {
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});
export const Unauthorized = makeFail('unauthorized');   // код из одной категории

return OrderNotFound({ orderId: '42' });
throw OrderNotFound({ orderId: '42' }, { cause: dbError });

if (OrderNotFound.is(result)) { … }      // сравнение по code
```

Код отказа — единственная его ось. Он состоит из сегментов через
двоеточие, каждый сегмент соответствует `[a-z_]+`; первый сегмент —
категория из закрытого перечня `categories`, остальные уточняют её. Тип
кода — `FailCode`: категорию проверяет компилятор, формат сегментов —
рантайм в `makeFail`. Поля `status` у определения и у отказа нет:
`categoryOf(code)` и `fail.category` дают категорию первым сегментом.

Определение — вызываемое значение со свойствами `code`, `category`,
`schema` и предикатом `is`. Конструктор принимает `details` (тип
выводится из схемы) и проверяет их схемой. `message` — строка или функция
от `details`; без него сообщением становится код. Без `details`
конструктор вызывается без аргументов: `EmailTaken()`.

`is` распознаёт код у двух носителей: у значения-отказа (в том числе
разобранного из JSON) и у контекста ответа-ошибки, который видит
`.catch`-юнит пайплайна.

### Отказы ядра

Эти отказы входят в множество ответов любого endpoint'а без объявления в
`errors`. Каждый несёт голую категорию, без уточнения:

| Определение | `code` | Кто создаёт |
|---|---|---|
| `InternalError` | `internal_error` | проверка на выходе из пайплайна: незадекларированный отказ или исключение |
| `BadRequest` | `bad_request` | проверка входа по схеме и разбор запроса; `details` — `issues` |
| `PayloadTooLarge` | `payload_too_large` | лимит тела, строки потока и `.limit(n)` item-цепочки; `details.limit` |
| `Timeout` | `timeout` | `.gapTimeout(ms)` item-цепочки и бюджет вызова порта (`meta.deadline`) |

`isKernelFailCode(code)` проверяет, входит ли код в этот набор. Набор
закрыт: добавить в него пользовательский код нельзя. Пользовательское
определение с тем же кодом (`makeFail('bad_request')`) — тот же отказ по
идентичности, и оно проходит проверку на границе.

## Формы io

Верхний уровень `input` и `output` — форма. Листья формы — Standard Schema
или примитивы `'binary'`/`'text'`. Схема сама по себе — форма значения;
конструктора `value(...)` нет.

| Форма | Payload | Media type |
|---|---|---|
| схема | значение | `application/json` |
| `stream(T, options?)` | `AsyncIterableIterator<T>`, конечные данные | `application/x-ndjson` |
| `events(T, options?)` | `AsyncIterableIterator<T>`, открытая подписка | `text/event-stream` |
| `multipart({ fields, files })` | `{ fields, files }` | `multipart/form-data` |

```typescript
input: multipart({
  fields: z.object({ id: z.string() }),
  files: { avatar: upload({ maxSize: 5 * MiB, mime: ['image/png'] }) },
}),
// payload: { fields: { id: string }, files: { avatar: FilePart } }
```

`upload({ maxSize?, mime?, multiple? })` описывает файловое поле;
`multiple: true` даёт `FilePart[]`. Лимиты применяются при разборе.

Потоковые формы несут item-цепочку. Каждый метод возвращает новую форму:

| Метод | Что делает |
|---|---|
| `.tap(fn)` | наблюдение за элементом |
| `.filter(pred)` | отбор элементов |
| `.limit(max)` | не больше `max` элементов, иначе `payload_too_large` |
| `.gapTimeout(ms)` | источник обязан отдавать элементы не реже `ms`, иначе `timeout` |
| `.throttle(perSecond)` | ограничение частоты; элементы буферизуются |
| `.batch(size)` | группировка в массивы; меняет тип элемента, поэтому разрешена только во входе |
| `.through(fn)` | произвольное преобразование; в выходе — только вариант `T → T` |

```typescript
const guarded = <T extends Schema>(s: T) => stream(s).limit(50_000).gapTimeout(30_000);

input: guarded(LogChunk).batch(100),   // хендлер получает LogChunk[]
output: stream(Row).limit(100_000),
```

Второй аргумент `stream`/`events` — политика поэлементной валидации:
`{ validate: true, onInvalid: 'fail' }` по умолчанию. `onInvalid: 'skip'`
пропускает невалидный элемент входа; на выходе эта опция не действует.

Форма проверяется при создании декларации: `multipart` в `output`,
`upload()` вне `multipart`, потоковая форма без листа, тип-меняющий шаг в
`output` — ошибка с именем endpoint'а, слота и формы (`assertFormSlots`).

Помощники: `isForm`, `isUploadSpec`, `isPrimitiveLeaf`, `isStreamKind`,
`describeForm(io)` (описатель для транспорта и генератора документации),
`mediaTypeOf(io)`, `nameOfForm(io)`. `assertFormsSupported(definition,
capabilities)` отвергает декларацию, чью форму транспорт не поддерживает.
`StreamSummary` и `makeSummary()` — счётчики `itemsIn`/`itemsOut`/`bytesIn`/`bytesOut`.

## HTTP-адрес: секция `http:` и bind-карта

Секция `http:` операции — строка `'POST /users/:id'` или запись:

| Поле | Значение |
|---|---|
| `method`, `path` | метод и шаблон пути; path-параметры пишутся `:name` |
| `bind` | пометки размещения полей `input`: `{ dryRun: query() }` |
| `rawBody` | отдавать реализации сырые байты тела (проверка подписи webhook) |
| `sse` | параметры SSE; допустимо только при `output: events(...)` |

Правило размещения полей `input` по умолчанию: поле с именем path-параметра
попадает в путь; остальные — в query для методов без тела (`GET`, `HEAD`,
`DELETE`, `OPTIONS`, `TRACE`) и в тело для остальных методов. Пометка
`query({ multiple? })` или `body()` переопределяет место одного поля.
`query({ multiple: true })` всегда даёт массив.

Секция разворачивается в bind-карту `HttpBinding` при создании операции:
`{ method, path, fields, rest, rawBody, operation?, sse? }`. Ту же карту
читают транспорт (разбор запроса), клиент (сборка запроса) и генератор
OpenAPI. Функции `computeHttpBinding`, `buildHttpBinding`, `readPathParams`,
`assertHttpPath`, `isBindMark`, `isHttpBinding` — для авторов транспортов
и генераторов.

## Секция `doc:`

| Поле | Значение |
|---|---|
| `summary` | короткое название операции |
| `description` | развёрнутое описание |
| `tags` | группировка |
| `deprecated` | операция устарела |
| `status` | успешный статус ответа; по умолчанию `ok`, без `output` — `no_content` |
| `hidden` | причина, по которой операция не попадает в документацию; только непустая строка |

Секция не зависит ни от транспорта, ни от формата документации:
`operationId` выводится, а не объявляется. В форме с операцией декларации
`doc` принадлежит операции вместе с `input`, `output` и `errors`.
Словарь проверяется при создании (`assertDoc`): неизвестное поле,
`hidden: true` или статус вне перечня успешных — ошибка.

## `jsonSchema(schema, json)`

Объявляет JSON Schema для листа явно. Возвращает новое значение, которое
валидирует так же, как исходная схема, и несёт объявленную JSON Schema:

```typescript
input: z.object({ payload: jsonSchema(ExoticSchema, { type: 'object' }) })
```

Аннотация работает в любой схемной позиции: `input`, `output`, лист
потоковой формы, `fields` формы `multipart`, `details` определения отказа.
Генератор документации предпочитает аннотацию конвертеру.
`jsonSchemaOf(leaf)` возвращает объявленную схему или `undefined`.

## Конвертеры схем

`SchemaDocConverter { vendor, toJsonSchema(schema, options?) }` — способ
получить JSON Schema схемы конкретного вендора. Standard Schema
непрозрачна в рантайме, поэтому устройство валидатора знает только
конвертер, и пишется он снаружи ядра.

`leafJsonSchema(converters, leaf, options?)` — диспетчер листа. Он
перебирает источники по порядку и возвращает один из трёх различимых
исходов:

| Исход | Что произошло |
|---|---|
| `declared` | JSON Schema объявлена аннотацией `jsonSchema` |
| `converted` | JSON Schema получена конвертером своего вендора |
| `unconvertible` | конвертера для вендора нет, и аннотации тоже |

Строгость диспетчер не зашивает: «конвертера нет» — наблюдаемый исход, а
решение принимает вызывающий. Генератор документации падает на старте,
снапшот операций ставит вердикт `unknown`, снимок конфига оставляет
описание ключа без JSON Schema.

`assertConverters(converters?)` проверяет список в точке передачи: два
конвертера с одним `vendor` делают выбор недетерминированным и потому
отвергаются сразу. `pickConverter` и `schemaVendorOf` — части того же
механизма.

`options.io` — подсказка направления: `input` описывает форму по сети,
`output` — форму после преобразований. Она необязательна с обеих сторон.

## Потоки

### Источник событий

```typescript
import { Topic } from '@nestling/operations';

class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  publish(event: ActivityEvent): void {
    this.#topic.push(event);          // не ждёт потребителей
  }

  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    return this.#topic.subscribe(signal);
  }
}
```

Источник событий — обычный провайдер-синглтон. Отдельного вида endpoint'а
или регистрации для него нет.

### Потоки говорят на `AsyncIterable`

Всё в пакете использует стандартный протокол языка. Своего типа `Stream`,
`Observable` или моста между ними нет. Подписка — это
`AsyncIterableIterator<T>`; комбинатор — функция из `AsyncIterable` в
`AsyncIterable`.

### `Topic<T>`

`new Topic<T>(options?)` создаёт тему. Опции:

| Опция | Значение |
|---|---|
| `buffer` | размер буфера на одного подписчика, по умолчанию 1024. `0` отключает буферизацию: событие получает только тот, кто уже ждёт `next()` |
| `onSlowConsumer` | что делать при переполнении буфера подписчика: `'drop-oldest'` (по умолчанию) или `'disconnect'` |

Члены темы:

| Член | Что делает |
|---|---|
| `push(value)` | публикует событие; возвращается сразу при любом числе подписчиков, включая ноль |
| `subscribe(signal?)` | возвращает `AsyncIterableIterator<T>`; подписка завершается по `signal`, по `close()` темы и когда потребитель выходит из итерации |
| `close()` | завершает все подписки нормально, без ошибки; последующие `push` ничего не делают |
| `subscribers` | число живых подписок |
| `dropped` | сколько событий потеряно из-за переполнения буферов |
| `closed` | вызывался ли `close()` |

Буфер заведён на каждого подписчика отдельно. Когда буфер переполняется,
срабатывает `onSlowConsumer`:

- `drop-oldest` — самое старое событие этого подписчика выбрасывается,
  `dropped` растёт, подписка продолжает работать;
- `disconnect` — эта подписка завершается, остальные не затронуты.

`push` никогда не ждёт потребителей. Завершение подписки освобождает её
буфер и снимает её с темы, поэтому циклы «подписался — отписался» не
накапливают ресурсов. Это верно и для потребителя, который вызвал
`return()`, не начав итерацию.

### Комбинаторы

Каждый комбинатор принимает `AsyncIterable` и возвращает новый
`AsyncIterableIterator`:

```typescript
import { filter, gapTimeout, limit } from '@nestling/operations';

const guarded = gapTimeout(limit(filter(source, keep), 50_000), 30_000);
```

| Комбинатор | Поведение |
|---|---|
| `tap(src, fn)` | вызывает `fn` для каждого элемента; исключение из `fn` прерывает поток |
| `filter(src, pred)` | пропускает только элементы, для которых `pred` вернул `true` |
| `limit(src, max, onExceeded?)` | отдаёт ровно `max` элементов, на следующем поток завершается ошибкой |
| `gapTimeout(src, ms, onTimeout?)` | завершается ошибкой, если источник молчит дольше `ms` (считается пауза источника, не потребителя) |
| `throttle(src, perSecond)` | ограничивает частоту до `perSecond` элементов в секунду; элементы буферизуются, не теряются |
| `batch(src, size)` | группирует элементы в массивы по `size`; остаток отдаётся при завершении источника |
| `through(src, fn)` | произвольное преобразование потока функцией `fn` |

`limit` и `gapTimeout` принимают фабрику ошибки. Без фабрики они бросают
`StreamLimitError` и `StreamGapTimeoutError` из этого пакета. Пайплайн
Nestling передаёт свои фабрики, поэтому внутри endpoint'а те же комбинаторы
завершаются встроенными отказами `payload_too_large` (413) и
`timeout` (504).

### Итерация под сигналом

```typescript
import { collect, untilAborted } from '@nestling/operations';

for await (const item of untilAborted(source, signal)) { … }

const items = await collect(source);
```

- `untilAborted(source, signal?)` завершает итерацию, когда сигнал взведён,
  и закрывает источник через `return()`. Поэтому `try/finally` внутри
  генератора-источника выполняется, а подписки снимаются. Источник
  закрывается в обеих ветках: и когда сигнал взвели во время итерации, и
  когда он был взведён до её начала — во второй итерация пуста. Без
  сигнала это прозрачная обёртка.
- `collect(source)` читает поток до конца и возвращает массив. Удобно в
  тестах.

## Кто читает пакет

| Потребитель | Что берёт |
|---|---|
| [`@nestling/client`](../nestling.client) | bind-карту, схему `output` и `errors`: собирает запрос, проверяет ответ, восстанавливает `Fail` |
| [`@nestling/transport.http`](../nestling.transport.http) | ту же карту: разбирает запрос в payload; реэкспортирует `query()`/`body()` |
| [`@nestling/app`](../nestling.app) | `.caller`/`.emitter`, `implement`, шину; реэкспортирует `Ok`/`Fail`, `makeFail`, формы io, `jsonSchema()` |
| [`@nestling/openapi`](../nestling.openapi) | bind-карту, формы io, `errors` и `doc` |

`makeRequest` / `makeCommand` / `makeEvent` импортируется только из `@nestling/operations`;
`@nestling/app` его не реэкспортирует.

## Две копии пакета

Пакет хранит модульное состояние: члены семейств DI-токенов вызывателей и
реестр имён операций. Две копии пакета в одном приложении дают два
реестра и две идентичности DI-токенов: операция, объявленный через одну
копию, вторая не распознает. Ошибка о дубликате имени говорит об этом
прямо. В монорепозитории с workspace-протоколом проблемы нет; вне его
держите одну версию пакета.

## Границы пакета

Пакет не выполняет запросы, не реализует операции и ничего не
регистрирует в приложении: реализация, вызов и обработка запроса живут в
`@nestling/app`. Операторов dataflow (`merge`, `switchMap`,
`combineLatest` и подобных) в потоковой части нет: такие преобразования
пишутся в хендлере любой библиотекой.
