# @nestling/pipeline

Типизированный пайплайн обработки запроса, не зависящий от транспорта:
декларации endpoint'ов (`makeEndpoint`), фазы `.pre`/`.ok`/`.catch`/
`.finally`, композиция слоёв (`compose`), политики сборки (`everyEndpoint`)
и ambient-контекст запроса (`contextVar`, `Ctx`).

> 🚧 Пакет в активной разработке, API может меняться. Валидатор схем в
> пакет не входит: подходит любая
> [Standard Schema](https://standardschema.dev) (zod, valibot, arktype,
> TypeBox, Effect Schema). Целевой дизайн —
> [`docs/design/pipeline.md`](../../docs/design/pipeline.md),
> [`docs/design/schemas.md`](../../docs/design/schemas.md); гайды —
> [глава 8. Видеть каждый запрос в логе](../../docs/guide/08-logging.md),
> [глава 9. Пускать только своих](../../docs/guide/09-auth.md),
> [глава 20. CLI-утилита на тех же примитивах](../../docs/guide/20-cli.md).

Декларативный слой — `Ok`/`Fail`, перечень статусов, `makeFail` со
встроенными кодами, формы io и `jsonSchema()` — живёт в
[`@nestling/operations`](../nestling.operations) и реэкспортируется отсюда
тем же модулем, так что идентичность значений не двоится. Схемный слой
(`validateSync`, ошибки схем) живёт в [`@common/misc`](../common.misc) и
тоже реэкспортируется. В этом пакете остаётся рантайм: сам пайплайн,
проверка операции отказов и обёртки потоков.

## Установка

```bash
npm install @nestling/pipeline
```

## Минимальный пример

```typescript
import { compose, makePipeline, Ok, makeFail, withRequestId } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const base = makePipeline().pre(withRequestId());

export const OrderNotFound = makeFail('not_found:order', {
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

export const GetOrder = httpEndpoint({
  method: 'GET',
  path: '/orders/:id',
  input: OrderId,
  output: Order,
  errors: [OrderNotFound],                      // типизированный канал отказов
  pipeline: base,
  handler: async ({ id }) => {
    const order = await orders.find(id);

    return order ? new Ok(order) : OrderNotFound({ orderId: id });
  },
});
```

## Декларация endpoint'а

Декларация — значение, а не класс с декораторами. `makeEndpoint` — базовый
конструктор с общим для всех транспортов словарём; в приложении
используются конструкторы транспортов, построенные над ним:
`httpEndpoint` из `@nestling/transport.http`, `cliEndpoint` из
`@nestling/transport.cli`. Создание декларации не имеет побочных
эффектов; набор обслуживаемых endpoint'ов берётся из дерева
зарегистрированных модулей (`@nestling/app`).

Поля словаря `EndpointOptions`:

| Поле | Значение |
|---|---|
| `transport` | токен транспорта; проставляет конструктор транспорта |
| `pattern` | строковый адрес внутри транспорта: `'GET /orders/:id'`, `'users:list'` |
| `input`, `output` | формы io (см. «Формы io») |
| `errors` | список определений `makeFail`; из него выводится тип отказов хендлера |
| `pipeline` | пайплайн endpoint'а |
| `handler` | хендлер в одной из трёх форм (см. ниже) |
| `binding` | транспортный биндинг; ядро переносит его как есть и не читает |
| `doc` | документация операции: `summary`, `description`, `tags`, `deprecated`, `status`, `hidden` |
| `detached` | причина, по которой endpoint выведен из-под всех политик сборки; только непустая строка |

`handler` принимается в трёх формах, и форма определяется по типу
значения:

| Форма | Запись |
|---|---|
| функция | `(input, meta) => …`; зависимостей нет, декларация исполнима сразу |
| объект с `deps` | `{ deps: [Token, …], handle: (…deps) => (input, meta) => … }`; внешний вызов происходит один раз, при получении зависимостей |
| класс-хендлер | класс с `@Injectable` и методом `handle`; экземпляр создаёт контейнер, а провайдером класса endpoint регистрирует себя сам |

Полей `deps` и `handle` на верхнем уровне словаря нет: их присутствие —
ошибка компиляции и ошибка рантайма при создании декларации.
`handlerDependenciesOf(endpoint)` отдаёт токены объектной формы,
`handlerClassOf(endpoint)` — класс-хендлер, если декларация объявлена
классом. Оба читает сборка.

Тип `EndpointDefinition<I, O, P, TNeeds>` хранит неразрешённые зависимости
в `TNeeds`: токены `handler.deps`, класс хендлера и классы юнитов
пайплайна.
Транспорты принимают только `TNeeds = never`, поэтому передать
неразрешённую декларацию в `server.route(...)` не получится: это ошибка
компиляции. `endpoint.resolve(resolver)` возвращает новую исполнимую
декларацию (исходная не меняется) и тем же резолвером связывает классы
юнитов пайплайна. `endpoint.resolve([instance, …])` — позиционная форма
для каррированных хендлеров вне контейнера.

Каждая декларация помечена неперечислимым символом
`Symbol.for('nestling:endpoint')`; `isEndpointDefinition(value)` — предикат,
которым discovery отбрасывает посторонние значения в `endpoints:`.

### `binding`: данные транспорта

`binding?: unknown` — место, где конструктор транспорта хранит свой
биндинг. `httpEndpoint` кладёт туда HTTP bind-карту, `httpBindingOf`
читает её обратно. Ядро это поле не интерпретирует: в
`@nestling/pipeline` нет понятий `path`, `query` и `body`, и новый
транспорт со своей формой биндинга не требует правок ядра.

### Начальный контекст

`makeEmptyContext(raw, endpoint, signal?, input?)` строит начальный
контекст запроса; его вызывает транспорт после разбора запроса. Четвёртый
аргумент — стартовый `input`: то, что транспорт знает до первого
`.pre`-юнита. По умолчанию он пуст, и тип контекста —
`ExtendableContext<EmptyInput>`. `@nestling/transport.http` использует его
для `rawBody: true`; тогда слой `makePipeline<{ rawBody: Uint8Array }>()`
компилируется только там, где байты действительно запрошены.

## Фазы пайплайна

Один вызов `makePipeline()` определяет один слой. Декларация читается
сверху вниз как порядок исполнения:

| Метод | Когда выполняется | Контекст |
|---|---|---|
| `.pre(unit)` | до хендлера, в порядке объявления | накопленный; каждый юнит добавляет типизированные поля |
| `.ok(unit)` | только для успешного ответа | полный: успех означает, что все `.pre` выполнились |
| `.catch(unit)` | только для ответа-ошибки | поля своего слоя — `Partial`, внешних слоёв — полные |
| `.finally(unit)` | всегда, последним | как `.catch`, плюс исход `completed`, `disconnected`, `aborted` или `failed` |

Если `.pre`-юнит завершился отказом, хендлер не вызывается, и пайплайн
переходит к ответной фазе с этим `Fail`. Отказ, который хендлер вернул,
обрабатывается так же, как брошенный.

`.ok`-юнит может заменить успех другим успехом. `.catch`-юнит может
заменить ошибку другой ошибкой: полным `ErrorResponseContext` или просто
`Fail`, который рантайм нормализует так же, как отказ хендлера.
Превращение `Fail` в `Ok` в `.catch` не поддерживается.

После `.ok`/`.catch` и до `.finally` рантайм сверяет ответ с полем
`errors` декларации: ошибка с кодом не из списка (и не из встроенных
кодов) заменяется на `InternalError`. `.finally` видит уже
нормализованный ответ. Для потокового `output` `.finally` откладывается
до завершения потока.

### Слои и `compose`

```typescript
export const base = makePipeline().pre(withRequestId()).finally(audit);
export const authed = compose(base, makePipeline().pre(withIdentity(verify)));
// у endpoint'а: pipeline: compose(authed, makePipeline<{ identity: User }>().pre(…))
```

`compose(outer, …, inner)` складывает слои: `.pre` выполняются снаружи
внутрь, ответные фазы и `.finally` — изнутри наружу. Слой объявляет свои
требования к внешнему контексту через `makePipeline<{ identity: User }>()`,
и компилятор проверяет их в точке композиции.

Юнит записывается в одной из трёх форм: функция, объект с методом
`handle()` или класс. Класс попадает в `TNeeds` пайплайна и требует
`bind(resolver)`; `@nestling/app` делает это на старте. Юниты —
синглтоны; состояние запроса хранится только в контексте.

## Политики сборки

Пайплайн помнит, из чего он собран: `compose(a, b)` хранит ссылки на
аргументы, вызовы `.pre`/`.ok`/`.catch`/`.finally` и `bind()` — ссылку
на предшественника. Исполнение это не читает; происхождение нужно, чтобы
идентичность слоя проверялась по ссылке:

```typescript
import { everyEndpoint } from '@nestling/pipeline';

makeApp({
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(authedBase, 'authedBase'),
  ],
});
```

- `everyEndpoint({ transport?, pattern? })` отбирает endpoint'ы: `transport`
  — токен транспорта, сравнивается по ссылке; `pattern` — `RegExp` по
  `endpoint.pattern`. Пустой фильтр означает все endpoint'ы приложения.
- `.hasLayer(layer, label?)` выполняется, когда пайплайн endpoint'а
  происходит от этого значения: `compose(base, authedBase)` подходит,
  вложенность транзитивна, `authedBase.pre(withTenant())` тоже подходит.
  Одноимённая копия слоя из другого файла не подходит. `label` используется
  только в тексте нарушения.
- `.hasVar(variable, label?)` выполняется, когда пайплайн объявляет
  ambient-переменную, то есть содержит юнит `<Var>.provide(…)`.
- Endpoint без `pipeline` нарушает политику: для инварианта «endpoint
  защищён» отсутствие пайплайна и отсутствие слоя неразличимы.
- `detached: '<причина>'` выводит endpoint из-под всех политик. Причина
  обязательна, переживает `resolve`, печатается на старте и попадает в
  отчёт `check()`.

`Policy` — открытый интерфейс с методами `describe()` и `check(subjects)`:
новый предикат — значение того же типа. Политики выполняет `@nestling/app`
в конце фазы ASSEMBLE.

## Ошибки

Отказ — обычное значение со стабильным машинным кодом. Поле `isFail`
переживает сериализацию, в отличие от `instanceof`; идентичность
определяется полем `code`.

- `Output<T, E>` и `OutputSync<T, E>` допускают `Ok<T>`, голое `T` и отказ
  из `E`; `E` записывается определениями (`typeof OrderNotFound`). Без
  `errors` `E` пуст: хендлер не может вернуть отказ, а `new Ok(fail)` не
  компилируется.
- Канон доставки отказа — `return`: возвращённый отказ виден в типе
  `Output`. `throw` доставляет отказ из глубины вызовов; ключа `fail` в
  `meta` нет.
- Всё незадекларированное, что дошло до выхода из пайплайна, — голый
  `throw`, отказ из глубины сервиса, анонимный `Fail.notFound(...)` без
  кода — заменяется на `InternalError` (`internal_error`, 500). Оригинал целиком
  передаётся в `ExecuteOptions.onUnknownFail` (по умолчанию
  `console.error`); клиент получает общее тело ответа.
- Отказы ядра входят в множество ответов каждого endpoint'а без
  объявления: `InternalError` (`internal_error`), `BadRequest`
  (`bad_request`: проверка входа, разбор запроса и поэлементная проверка
  потока), `PayloadTooLarge` (`payload_too_large`: лимит размера входа и
  `.limit(n)` item-цепочки), `Timeout` (`timeout`: `.gapTimeout(ms)` и
  бюджет вызова порта). Каждый несёт голую категорию; набор закрыт и
  растёт только вместе с ядром.
- `Category` не зависит от транспорта (`conflict`, `timeout`,
  `too_many_requests`, `payload_too_large`, …); в HTTP-код её переводит
  транспорт.

`ExecuteOptions` также принимает `exposeErrorDetails` — раскрывать ли
клиенту `message` и `stack` необработанных исключений (по умолчанию
`false`).

Тело ответа-отказа (`ErrorDetails`) несёт обязательный `code`, текст
`error` и, если определение объявило схему, `details`. Поля `status` в
теле нет: категорию получатель восстанавливает из кода. У
`ErrorResponseContext` поле `status` равно категории отказа.

Целевой дизайн — [`docs/design/errors.md`](../../docs/design/errors.md).

## Формы io

Верхний уровень `input` и `output` — форма; листья — Standard Schema или
примитивы `'binary'`/`'text'`. Схема сама по себе (или отсутствие
`input`) — форма значения.

| Форма | Payload | Media type |
|---|---|---|
| схема | значение | `application/json` |
| `stream(T)` | `AsyncIterableIterator<T>`, конечные данные | `application/x-ndjson` |
| `events(T)` | `AsyncIterableIterator<T>`, открытая подписка | `text/event-stream` |
| `multipart({ fields, files })` | `{ fields, files }` | `multipart/form-data` |

```typescript
input: multipart({
  fields: z.object({ id: z.string() }),
  files: { avatar: upload({ maxSize: 5 * MiB, mime: ['image/png'] }) },
}),
// payload: { fields: { id: string }, files: { avatar: FilePart } }
```

Форма — неизменяемое значение с неперечислимой пометкой, поэтому объект
`{ kind: 'stream' }` формой не считается. `describeForm(io)` читают
транспорты, генераторы документации и рантайм; `mediaTypeOf(io)` переводит
форму в media type. Формы проверяются при создании декларации:
`multipart` в `output`, `upload()` вне `multipart`, потоковая форма без
листа, тип-меняющий шаг цепочки в `output` — ошибка с именем endpoint'а,
слота и формы.

### Item-цепочки

Набор комбинаторов фиксирован: `.tap`, `.filter`, `.limit`, `.gapTimeout`,
`.throttle`, `.batch`, `.through` (реализованы в
[`@nestling/streams`](../nestling.streams)). Каждый возвращает новую форму,
поэтому цепочки переиспользуются через функции:

```typescript
const guarded = <T extends Schema>(s: T) => stream(s).limit(50_000).gapTimeout(30_000);

input: guarded(LogChunk).batch(100),   // хендлер получает LogChunk[]
output: stream(Row).limit(100_000),    // только T → T
```

Асимметрия входа и выхода задана типом слота: `output` принимает
`StreamForm<T, T>`, `input` — `StreamForm<T, any>`. Поэтому `.batch(100)`
в `output` не компилируется, а `.through` там допустим только в форме
`T → T`.

Поэлементная валидация симметрична: на входе элемент проверяется до
цепочки, на выходе — после. Политика задаётся вторым аргументом формы, по
умолчанию `{ validate: true, onInvalid: 'fail' }`. `onInvalid: 'skip'`
пропускает невалидный элемент входа; на выходе эта опция игнорируется.

### Потоковый ответ завершается позже

Для потокового `output` пайплайн отдаёт транспорту итератор-обёртку.
Закрытие обёртки (нормальный конец, ошибка или `return()` потребителя)
вычисляет исход и выполняет `.finally` ровно один раз. Отсюда обязанность
транспорта: потребить итератор или закрыть его, в том числе при ошибке
записи и при обрыве соединения. Непотоковые ответы завершаются сразу.

`ctx.summary` (`itemsIn`, `itemsOut`, а также `bytesIn`/`bytesOut`, если
транспорт их считает) — живой объект, созданный вместе с контекстом.
Он доступен любому юниту; у непотокового endpoint'а счётчики остаются
нулями.

`assertFormsSupported(definition, capabilities, where?)` — проверка форм
декларации против `capabilities` транспорта при регистрации; см.
[`@nestling/transport`](../nestling.transport).

Целевой дизайн — [`docs/design/streaming.md`](../../docs/design/streaming.md),
[`docs/design/endpoints.md`](../../docs/design/endpoints.md).

## Схемы: Standard Schema на границах

Каждая схемная граница ядра — `input`/`output` endpoint'а, `EndpointMeta`,
`parsePayload`/`parseMetadata`, `DomainType`, `Schema`/`Infer` из
`@common/misc` — типизирована как `StandardSchemaV1`. Валидация всегда идёт
через `schema['~standard'].validate(value)`, тип домена выводится через
`StandardSchemaV1.InferOutput`. Ядро не заглядывает внутрь схемы.

Вся валидация проходит через одну функцию `validateSync(schema, value,
message)`, поэтому форма ошибки одинакова на всех путях: проверка входа
рантаймом, поэлементная проверка NDJSON, поля секций конфига.

| Ошибка | Когда | HTTP |
|---|---|---|
| `SchemaValidationError` | значение не прошло схему; поле `issues: { message, path? }[]`, готовое к сериализации | 400 |
| `AsyncSchemaNotSupportedError` | `~standard.validate` вернул Promise; асинхронная проверка — ошибка конфигурации приложения, а не входа | 500 |
| `NotAStandardSchemaError` | объект не содержит `~standard` с `version: 1` (обычно валидатор старше zod 3.24 / valibot 1.0) | 500 |

Асинхронные refinement'ы в схемах endpoint'а отклоняются: валидация в
пайплайне синхронна. Асинхронную проверку переносите в юнит или хендлер.

### Конвертеры схем

Standard Schema даёт валидацию и вывод типов, и ничего больше. Всё, чему
нужна структура схемы, идёт через явный конвертер:

```typescript
export interface SchemaDocConverter {
  readonly vendor: string;                       // сравнивается с `~standard.vendor`
  toJsonSchema(schema: StandardSchemaV1, options?: SchemaDocOptions): unknown;
}

const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});
```

`SchemaDocOptions` несёт одну подсказку — `io: 'input' | 'output'`. Схема
с преобразованием (`z.string().transform(Number)`) описывает две формы:
что приходит по сети и что получает хендлер. Тело запроса документируется
первой, тело ответа — второй. Подсказка необязательна с обеих сторон.

Что происходит, когда конвертера для вендора нет, решает потребитель:
генератор документации (`@nestling/openapi`) падает на старте, снапшот
операции (`@nestling/ports`) считает лист непрозрачным. Поэтому
`leafJsonSchema(converters, leaf, options?)` возвращает один из трёх
результатов — `declared` (у листа есть аннотация), `converted`,
`unconvertible` — и оставляет решение вызывающему. `pickConverter`
возвращает сам конвертер. `assertConverters(list)` падает, если два
конвертера претендуют на один вендор. Список конвертеров — данные
вызывающего; глобального реестра нет.

`jsonSchema(schema, json)` объявляет JSON Schema для листа явно и работает
в любой схемной позиции; аннотация приоритетнее конвертера. Так объявлены
схемы встроенных отказов (`bad_request` и другие). Подробнее — в
[`@nestling/operations`](../nestling.operations).

## Диагностика типов

Когда требования слоя не выполнены, тип параметра сворачивается в
читаемый литерал вместо трассы дженериков:

```
Argument of type 'PipelineBuilder<{ identity: User; requestId: string; }, …>'
is not assignable to parameter of type '{ __error: "Layer requires context
that outer layers do not provide"; missing: { identity: User; }; }'.
```

`missing` — запись «имя поля: его тип», а не объединение ключей: поле,
которое есть, но несовместимого типа, тоже попадает туда. Та же форма
используется во всех местах, где пайплайн отклоняет аргумент: в точке
композиции, в `.pre` (переопределение поля даёт
`conflicting: { field: [was, now] }`) и в слоте `pipeline` транспортной
декларации (там литерал несёт ещё и `hint`).

Тексты закреплены снапшот-тестами, а стоимость типовой машины ограничена
бюджетом. Оба живут в [`type-tests/`](./type-tests):

| Путь | Что это |
|---|---|
| `type-tests/fixtures/` | по одному файлу на заведомо неверную композицию |
| `type-tests/__snapshots__/` | закреплённые тексты диагностик; диф ловит деградацию сообщения при обновлении TypeScript |
| `type-tests/bench/` | генератор синтетического графа из ~50 слоёв и запуск бюджета |
| `type-tests/BUDGET.md` | пороги, журнал измерений и объяснение каждого числа |

```bash
yarn workspace @nestling/pipeline type-budget          # только бюджет
yarn workspace @nestling/pipeline type-budget --report # измерить, не падать
yarn verify                                            # build + lint + test + type-budget
```

Фикстуры намеренно не компилируются, поэтому каталог исключён из `build` и
`lint` пакета.

## Ambient-контекст запроса

Хендлер видит накопленный `input`; репозиторий тремя слоями ниже — нет.
Вместо того чтобы протаскивать `requestId` через каждую сигнатуру,
объявите ambient-переменную: типизированный ключ того же накопленного
`input`.

```typescript
import { contextVar, Ctx, RequestId, Signal } from '@nestling/pipeline';
import type { CtxReader } from '@nestling/pipeline';

export const TenantId = contextVar<string>()('tenantId');   // тип, затем ключ

// Писатель: переменная строит юнит по своему ключу
const withTenant = () =>
  TenantId.provide((ctx) => ctx.raw.attributes['x-tenant'] as string);

// Читатель: член приватного семейства `Ctx` — обычный узел графа
@Injectable([Ctx(RequestId), ILogger])
export class UsersRepository {
  constructor(
    private readonly requestId: CtxReader<string>,
    private readonly logger: ILoggerService,
  ) {}

  async byId(id: string) {
    this.logger.debug(`[${this.requestId.peek() ?? 'n/a'}] select ${id}`);
  }
}
```

- Читатель — ребро графа, а не глобальная переменная. Он виден в
  визуализации, набор чтений известен на `build()`, а тесты
  подменяют его обычным `valueProvider` (`contextValue` в
  `@nestling/testing`). `Ctx` типизирован значением переменной:
  `Ctx('requestId')` со строкой не компилируется.
- `get(): T` бросает `ContextVarUnavailableError` с текстом, который
  называет причину (нет скоупа; ответная фаза, где проекция `Partial`; не
  скомпонован писатель) и способ починить. `peek(): T | undefined` — для
  ответной фазы, `@OnStart`, cron и фоновых задач.
- Ячейка хранит накопленный `input`, `signal` и фазу; `raw`, `endpoint` и
  `summary` наружу не выдаются. `Signal` — переменная только для чтения
  (`Ctx(Signal)`); ключ `'signal'` зарезервирован, `contextVar('signal')`
  падает при объявлении.
- Единственный писатель ячейки — рантайм пайплайна; публичного сеттера
  нет. Скоуп открывается вокруг всего исполнения (`.pre`, хендлер, ответная
  фаза, `.finally`), а для потоковых ответов — вокруг каждого `next()`
  возвращённого итератора. Код, отложенный внутри запроса и переживший
  его (таймер, fire-and-forget), видит ячейку с финальным `input`.
- `@nestling/app` регистрирует kernel-модуль читателей всегда
  (`contextKernel()`). Без единого `Ctx(...)` в `deps` семейство не
  создаёт ни одного узла. Endpoint без пайплайна тоже получает скоуп
  (пустой `input` плюс сигнал запроса) от `@nestling/transport`.
- Одна копия пакета — одно хранилище. Ячейка — модульное состояние
  `@nestling/pipeline`; две копии пакета в графе зависимостей дают два
  хранилища, и чтения возвращают `undefined`. Держите одну версию.
- Переход через границу порта включается для каждой переменной отдельно:
  `contextVar<string>()('tenantId', { propagate: true })`. Вызыватель порта
  собирает значения таких переменных из ячейки текущего запроса и кладёт
  их в конверт шины; получатель видит их в `ctx.raw.attributes`.
  Проекцию на принимающей стороне включает второй писатель, построенный
  той же переменной, — `TenantId.propagated()`; `hasVar` его учитывает.
  Переданные значения не валидируются: у ambient-переменной нет схемы.
  Переменные только для чтения (`Signal`) не передаются.
- Наличие переменной проверяется на сборке:
  `everyEndpoint(…).hasVar(RequestId)`. Типы уже покрывают юнит, читающий
  `ctx.input.requestId`; политика покрывает чтения из глубины графа, где
  типов входа нет.

## Отмена: `meta.signal`

Каждый вызов хендлера получает `meta.signal: AbortSignal`, проверять его на
`undefined` не нужно. Транспорты взводят сигнал при обрыве соединения и при
остановке приложения; юниты читают его как `ctx.signal`. Если транспорт
сигнал не передал, подставляется сигнал, который никогда не взводится.
Отмена кооперативна: хендлер сам решает, как на неё реагировать. Ключ
`signal` в `meta` зарезервирован: пайплайн кладёт туда сигнал контекста
поверх любого одноимённого поля из `.pre`-юнита.

## Проверка входа

Вход проверяется по схеме `input` декларации всегда: это обязанность
рантайма, а не юнита пайплайна. Проверка выполняется в одной точке —
после всех `.pre`-юнитов и перед хендлером, — поэтому хендлер получает
выход схемы, а невалидный вход даёт отказ `bad_request` (400),
который видят `.catch` и `.finally` всех слоёв.

Что именно проверяется, определяет форма io:

| Форма `input` | Что проверяется |
|---|---|
| схема (форма значения) | значение целиком |
| `'binary'`, `'text'`, `input` не объявлен | ничего: хендлер получает значение как есть |
| `multipart({ fields, files })` | поля схемой `fields`; файлы передаются без изменений |
| `stream(T)`, `events(T)` | элементы по одному во время чтения (item-цепочка) |

Отказаться от проверки можно схемой, которая принимает любое значение
(`z.unknown()`). Отдельного флага декларации или юнита для этого нет.

Ключ `payload` в контексте зарезервирован: `.pre`-юнит кладёт туда
значение, которое рантайм проверит вместо `raw.payload`. Так распаковывают
конверт запроса, не теряя проверку. В `meta` хендлера ключ не попадает.

Асинхронная схема и объект, не реализующий Standard Schema, — ошибки
конфигурации приложения: они дают 500, а не 400.

## Готовые юниты

| Юнит | Что делает |
|---|---|
| `withRequestId()` | кладёт в контекст `requestId` и объявляет переменную `RequestId` |
| `withRequestLogging(logger)` | пишет в `logger.log` строку о начале обработки запроса; в контекст ничего не добавляет |
| `withIdentity(authenticate)` | вызывает `authenticate(raw)` и кладёт результат в `identity` |
| `withPermissions(getPermissions)` | вызывает `getPermissions(identity)` и кладёт результат в `permissions`; требует `identity` в контексте |

## Границы пакета

Пакет не знает ни одного транспорта (`path`, `query`, `body` — словарь
`@nestling/transport.http`), не содержит валидатора схем и не регистрирует
endpoint'ы: их набор берётся из дерева модулей `@nestling/app`.
