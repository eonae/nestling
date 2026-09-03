# @nestling/ports

Реализация и вызов операций между фичами, in-process шина сообщений и
отчёт о совместимости операций.

> 🚧 Активная разработка, API может меняться. Целевой дизайн:
> [`docs/design/operations.md`](../../docs/design/operations.md).
> Гайд: [глава 12. Выделить вторую область](../../docs/guide/12-features.md).

Зависимости: `@nestling/container`, `@nestling/operations`,
`@nestling/pipeline`, `@nestling/transport`, `@nestling/streams`,
`@nestling/config`, `@common/misc`. Валидатор схем пакет не выбирает:
лист операции — любое значение
[Standard Schema v1](https://standardschema.dev).

`makeRequest` / `makeCommand` / `makeEvent` импортируется из [`@nestling/operations`](../nestling.operations),
а не отсюда: объявление операции живёт в пакете без серверных
зависимостей, чтобы его можно было импортировать во фронтенд. Этот пакет
реэкспортирует только типы вызывателей: `Port`, `Emitter`, `PortMeta`,
`CommandMeta`.

## Установка

```bash
npm install @nestling/ports @nestling/operations
```

## Минимальный пример

```typescript
import { makeRequest } from '@nestling/operations';
import { implement } from '@nestling/ports';

// Операция: имя, вид, схемы входа и выхода, список отказов
export const ClaimQuota = makeRequest({
  name: 'quotas.claim',                    // адрес: subject шины и ключ discovery
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

// Реализация: endpoint, который обслуживает операция
export const ClaimQuotaImpl = implement(ClaimQuota, {
  handler: {
    deps: [QuotaService],
    handle: (quotas) => async (payload) => {
      const claimed = quotas.claim();

      return claimed.ok
        ? new Ok({ remaining: claimed.remaining })
        : QuotaExceeded({ limit: quotas.limit });
    },
  },
});

export const QuotasModule = makeFeature({
  name: 'module:quotas',
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl],             // рядом с HTTP-endpoint'ами
});

// Вызов из другой фичи: порт инжектируется как обычная зависимость
export const CreateUser = httpEndpoint({
  /* … */
  handler: {
    deps: [ClaimQuota.caller],
    handle: (quotas) => async (input) => {
      const claimed = await quotas.call({ email: input.email });
      if (claimed.isFail) {
        return claimed;                    // отказ соседа разбирает вызывающий
      }
      /* … */
    },
  },
});
```

## Основные понятия

### Операция

Операция — значение. Она ничего не регистрирует ни в модуле, ни в
приложении. В приложение она попадает двумя путями: кто-то её реализует
через `implement`, кто-то инжектирует его вызыватель.

| Вид | Семантика | Владельцев | Вызыватель |
|---|---|---|---|
| `request` | запрос-ответ, может вернуть `Fail` | ровно один | `.caller` → `call(input, meta?)` |
| `command` | без ответа | ровно один | `.emitter` → `emit(payload, meta?)` |
| `event` | факт для подписчиков | 0..N подписчиков | `.emitter` → `emit(payload, meta?)` |

Поле `durable: true` разрешено у `command` и `event`; у `request` оно
отвергается при объявлении. Как именно доставка становится долговечной,
решает транспорт ([`@nestling/transport.nats`](../nestling.transport.nats)).
Шина без этой возможности всё равно стартует и один раз печатает список
операций, которые обслуживает без персистентности.

Версия входит в имя операции (`users.create.v2`); отдельного поля версии
нет. Две операции с одним именем — ошибка при объявлении.

### Реализация

`implement(Operation, { handler, subscriber?, pipeline?, detached? })` строит
декларацию endpoint'а на том же примитиве, что `httpEndpoint` и
`cliEndpoint`. Поэтому реализация получает всё, что есть у обычного
endpoint'а: discovery по дереву модулей, `dispatch`, пайплайн и проверку
отказов на выходе, `policies` и `detached`, отчёт `check()` и вызов
`testApp.call(ClaimQuotaImpl, payload)` в тестах.

Поля `input`, `output` и `errors` берутся из операции. Попытка объявить
их в реализации — ошибка компиляции.

Реализация события обязана назвать себя полем `subscriber:`. Это адрес
подписки: `quotas.claim@billing` внутри процесса и имя queue-group, когда
за шиной стоит брокер. У `request` и `command` владелец ровно один, поэтому
`subscriber` у них запрещён.

### Вызов

`.caller` и `.emitter` — обычные токены (члены семейств токенов). Их можно
использовать везде, где принимается токен. В composition root ничего
регистрировать не нужно: узел вызывателя создаётся только для операций,
которые кто-то инжектирует.

- `call(input, meta?)` возвращает `Promise<Ok<Output> | Fail<E ∪ InternalError>>`.
- `emit(payload, meta?)` возвращает `Promise<void>` и завершается по факту
  доставки, а не обработки. Ошибка подписчика до вызывающего не доходит.

Задекларированный отказ восстанавливается из `code` в настоящий `Fail`, так
что `QuotaExceeded.is(result)` работает и при локальном, и при удалённом
вызове. Незадекларированная ошибка превращается в `InternalError`; исходная
ошибка попадает в диагностический хук, но не к вызывающему.

### Параметры вызова: `meta`

`meta` — параметры одного вызова: `signal`, `deadline` и, только у
`command`, `idempotencyKey`.

```typescript
import { deadlineIn } from '@nestling/ports';

await quotas.call({ email }, { deadline: deadlineIn(500) });
await ship.emit({ orderId }, { idempotencyKey: orderId });
```

`deadline` — момент времени (`Date`), а не длительность. `deadline: 500`
не компилируется; `deadlineIn(ms)` вычисляет момент из длительности.
Бюджета по умолчанию нет: вызов без `deadline` не ограничен по времени.

Бюджет проверяется в трёх точках. Отказ всегда один и тот же:
`timeout` со статусом `timeout` (HTTP 504).

| Точка | Когда | Что происходит |
|---|---|---|
| до вызова | `call` / `emit` | остаток ≤ 0: `Timeout`, ни `dispatch`, ни шина не вызываются |
| до обработки | сообщение получено | остаток ≤ 0: `Timeout`, `dispatch.call` не вызывается |
| во время обработки | вызов выполняется | срабатывает `ctx.signal` хендлера, вызов завершается `Timeout` |

Отмена через `meta.signal` вызывающего остаётся `InternalError`. По сети
передаётся относительный `timeoutMs`; получатель пересчитывает его в
абсолютный момент по своим часам, поэтому расхождение часов между
процессами на бюджет не влияет. Поведение одинаково при `local-first` и
`always-remote`.

`idempotencyKey` есть только в `meta` операций вида `command`; у
`request` и `event` это ошибка компиляции. `emit` команды всегда уходит с
ключом: либо переданным вызывающим, либо сгенерированным вызывателем. Ядро
гарантирует две вещи: ключ доходит до получателя и виден хендлеру.
Дедупликация в ядро не входит.

Внутри хендлера параметры вызова доступны двумя способами:

| Канал | Что это | Когда доступен |
|---|---|---|
| `ctx.raw.attributes` | атрибуты запроса рядом с `subject` | всегда |
| `Ctx(Deadline)` / `Ctx(IdempotencyKey)` | переменные асинхронного контекста | когда в пайплайн добавлены `withDeadline()` / `withIdempotencyKey()` |

Переменные экспортируются как значения, поэтому
`everyEndpoint(…).hasVar(IdempotencyKey)` проверяет их наличие на сборке.
Вложенный вызов бюджет не наследует: хендлер передаёт остаток явно, как и
`signal`.

```typescript
handler: {
  deps: [Ctx(Deadline), ChargeCard.caller],
  handle: (deadline, charge) => async (input) =>
    charge.call(input, { deadline: deadline.peek() }),
},
```

### Политика диспатча

| Политика | Поведение |
|---|---|
| `local-first` (по умолчанию) | реализация в том же процессе вызывается через `dispatch` шины: полный пайплайн, без копирования payload |
| `always-remote` | тот же вызов идёт через шину: асинхронный барьер, структурная копия payload и ответа, ответ проверяется схемой `output` операции |

```bash
NESTLING_PORTS_DISPATCH=always-remote node dist/main.js
```

Без брокера `always-remote` показывает в dev и в тестах всё, что не
переживёт `structuredClone`. С брокером каждый вызов становится
сообщением по сети. Код вызова в обоих случаях один и тот же.

Политика лежит в секции конфига ядра `nestlingPorts` и читается обычным
механизмом конфигурации: её можно переключить привязанным источником или
`vars()` в тестовом корне, а не только переменной окружения. Поля
`dispatch:` у `assemble` нет.

### Проверки на сборке

Фаза ASSEMBLE завершается ошибкой во всех случаях, которые можно проверить
без сети:

- `request` или `command` без реализации среди выбранных фич и с шиной,
  которая не доставляет за пределы процесса;
- второй владелец `request`/`command` (в ошибке названы оба модуля);
- два подписчика события с одним именем;
- отсутствующий или запрещённый `subscriber`;
- операция с формами io `stream` или `events` (шина передаёт только `value`).

Событие без подписчиков разрешено.

Привязка вызывателя зависит от трёх вещей: топологии, свойства `remote`
шины и политики диспатча. Если шина удалённая, «владелец не выбран здесь»
означает «владелец в другом процессе»: `request` и `command` привязываются
к удалённому вызову вместо ошибки, а `event` всегда идёт через шину,
потому что часть подписчиков может жить в других процессах.

### Фазы

`dispatch` создаётся на фазе WIRE. Там же происходит единственная поздняя
привязка: вызыватели получают исполнителя, а шина подписывается на
subject'ы своих маршрутов. Вызов порта в `@OnInit` завершается ошибкой; в
`@OnStart` он работает.

### Шина

`IMessageBus` — минимальный интерфейс брокера: `request`, `publish` и
`subscribe` с группой доставки. Специфика конкретного брокера за этот
интерфейс не выходит. `InProcessBus` реализует `IMessageBus` и
`ITransport` одновременно; ту же пару интерфейсов реализует `NatsBus`.

Интерфейс объявляет две возможности значениями: `remote` (доставляет ли
шина за пределы процесса; вход привязки вызывателей) и `durable` (умеет
ли долговечную доставку). У `InProcessBus` оба равны `false`. Её
broadcast построен на `Topic` из `@nestling/streams`, поэтому публикация
никогда не ждёт медленного подписчика.

Composition root про шину может ничего не знать: модуль ядра портов
регистрирует `InProcessBus`, когда в приложении есть хотя бы одна
реализация операции. Корень может передать шину сам, так подключается
брокер: `nats()` в `transports:` (см.
[`@nestling/transport.nats`](../nestling.transport.nats/README.md)). Тогда
модуль ядра свою шину не регистрирует. В приложении ровно одна шина, и
`BusTransport$` с `MessageBus$` указывают на один и тот же экземпляр.

### Совместимость операций

Версия операции живёт в имени (`user.create.v2`). `makeRequest` / `makeCommand` / `makeEvent` суффикс
`.vN` не требует и не разбирает; имя без версии допустимо.

Форму операции «как было вчера» хранит снапшот — обычное значение,
которое вы сохраняете, где удобно:

```typescript
import { checkTopologies } from '@nestling/testing';

const descriptor = describeOperation(ClaimQuota, { converters: [zodConverter()] });
// { name, kind, input: { kind, leaf }, output: { … }, errors: [{ code, category }] }

const snapshot = snapshotOperations(await checkTopologies(app, ['all', 'users'], {
  converters: [zodConverter()],
}));

const report = diffOperations(readBaseline(), snapshot);
console.log(formatCompatibility(report));
```

- `describeOperation(source, { converters? })` превращает операцию или её
  `implement`-декларацию в JSON-значение. Листовые схемы проходят через
  конвертер вендора (`SchemaDocConverter`, тот же тип, что у
  [`@nestling/openapi`](../nestling.openapi)). Без конвертера лист помечается
  непрозрачным; «листа нет» и «лист не удалось преобразовать» — разные
  пометки. Лист с аннотацией `jsonSchema(schema, json)` описывается по
  аннотации независимо от наличия конвертера.
- `snapshotOperations(reports)` объединяет отчёты матрицы топологий
  `select`. Операция, которой нет в одной из топологий, считается
  невыбранной фичей, а не удалённой операцией; каждый дескриптор
  перечисляет топологии, которые его опубликовали. `serializeSnapshot`
  даёт побайтно детерминированный вывод: операции по имени, отказы по
  коду, ключи JSON Schema отсортированы.
- `diffOperations(baseline, current)` присваивает каждому расхождению один
  вердикт: `breaking`, `additive` или `unknown`. Направление зависит от
  слота: во `input` новое обязательное свойство, удалённое свойство и
  сужение — `breaking`; в `output` удалённое свойство и переход
  `required` в `optional` — `breaking`. Всё, что правила не покрывают
  (незнакомые ключевые слова JSON Schema, `oneOf`/`allOf`/`$ref`, смена
  вендора, непрозрачный лист), получает вердикт `unknown` с JSON-путём.
- Отчёт — значение. `formatCompatibility` печатает его для человека;
  операция хотя бы с одним `breaking` получает предложенное имя
  (`suggestBump`: `quotas.claim` становится `quotas.claim.v2`). Ничего не
  переименовывается.

`diffOperations` — чистая функция двух значений. Она не участвует в сборке,
не вызывается из `run()` и `check()` и не бросает исключений из-за
результата сравнения. Чтобы отчёт ронял тест, напишите
`expect(report.breaking).toEqual([])`. Единственное исключение функция
бросает на нечитаемый baseline (неизвестный `snapshotVersion`).

## Справочник API

| Экспорт | Что это |
|---|---|
| `implement(operation, declaration)` | декларация реализации операции |
| `deadlineIn(ms)`, `deadlineFromTimeout(ms?)`, `isExhausted(deadline?)` | работа с моментом `deadline` |
| `Deadline`, `IdempotencyKey`, `withDeadline()`, `withIdempotencyKey()` | переменные контекста параметров вызова и `.pre`-юниты, которые их заполняют |
| `profileAttributes`, `startBudget`, `CallBudget`, `failureResponse` | инструменты автора реализации шины |
| `Timeout` | определение отказа бюджета (реэкспорт из `@nestling/pipeline`) |
| `IMessageBus`, `MessageBus$`, `InProcessBus`, `InProcessBusOptions` | интерфейс шины, её токен и реализация в процессе |
| `RequestOptions`, `PublishOptions`, `SubscribeOptions`, `BusHandler`, `BusMessageMeta`, `BusSubscription` | типы операций шины |
| `BusTransport$`, `BUS_TRANSPORT_NAME`, `busBindingOf`, `BusBinding` | токен транспорта шины и привязка декларации к шине |
| `portsKernel`, `bindPorts`, `undurableOperations`, `collectImplementations` | точки, которыми пользуется composition root |
| `portsConfigKeys`, `DispatchPolicy`, `PortsConfig` | ключи секции конфига `nestlingPorts` |
| `describeOperation`, `canonicalizeJson`, `OperationDescriptor` | описание операции JSON-значением |
| `snapshotOperations`, `serializeSnapshot`, `SNAPSHOT_VERSION`, `OperationSnapshot` | снапшот операций |
| `diffOperations`, `formatCompatibility`, `suggestBump`, `CompatibilityReport` | сравнение снапшотов |
| `Port`, `Emitter`, `PortMeta`, `CommandMeta`, `PortResult`, … | типы вызывателей (реэкспорт из `@nestling/operations`) |

`InProcessBusOptions`: `buffer` (размер буфера на подписчика),
`onDeliveryFailure` (хук отказа доставки), `onUnknownFail` (хук
незадекларированной ошибки).

Не экспортируются: реестр операций, семейства `Port`/`Emitter` и их
рецепты, держатель исполнителей и его токен, токен секции конфига. Это
сторона ядра; граница держится видимостью ES-модулей.

## Границы пакета

Пакет не дедуплицирует команды по `idempotencyKey`, не хранит снапшоты и
не реализует доставку за пределы процесса: для этого нужен транспорт
брокера.
