# Стриминг: `stream`/`events`, item-цепочки, граница с RxJS

> **Целевое состояние V1.** Логика решений: [ideas.md](../decisions/ideas.md) —
> «Стриминг: `stream(T)` ≠ `events(T)`, AbortSignal, источники событий»
> [2026-07-06], «Два скоупа обработки: request-pipeline и item-цепочки»
> [2026-07-06] (там же — «Не переизобретаем ли мы RxJS?»), «Контракт
> первичен» [2026-07-13] (формы io). Статус реализации —
> [roadmap](../decisions/roadmap.md).

## 1. Границы — стандартный `AsyncIterable`

Все стриминговые границы фреймворка — стандартный протокол языка, не
библиотечный тип: входной стрим приходит в хендлер как
`AsyncIterableIterator<T>`; стриминговый ответ — `yield` из
хендлера-генератора; подписка на источник (`Topic`) — `AsyncIterable`.
Pull-модель даёт backpressure бесплатно: медленный клиент просто не
запрашивает следующий элемент.

Отмена — сквозная: `meta.signal` взводится транспортом при дисконнекте и
приложением при shutdown. Ключ `signal` в `meta` **зарезервирован**
пайплайном (`request-abort-signal`), поэтому третья причина отмены —
административное завершение — приезжает не в него, а **вторым полем**:
слой `tracked` реестра подписок кладёт в `meta.subscription` комбинацию
`AbortSignal.any([сигнал запроса, административный контроллер])`
([§4.1](#41-реестр-подписок)). Хендлер трекаемой ручки слушает
`meta.subscription.signal` и одной подпиской закрывает все три причины;
хендлер обычной ручки — `meta.signal`. Уважать сигнал хендлер обязан сам;
для `for await` по подписке это происходит естественно.

## 2. `stream(T)` ≠ `events(T)`

| | `stream(T)` | `events(T)` |
|---|---|---|
| Природа | конечные данные (экспорт, большой результат) | открытая подписка |
| Конец | естественный (данные закончились) | нет; «нормальное завершение» = дисконнект |
| HTTP-framing | NDJSON / chunked | SSE: heartbeat, `id:`, реконнект по `Last-Event-ID` |
| Нормальный исход | `completed` | `disconnected` |
| Доки | OpenAPI | AsyncAPI |

Словарь исходов для `finally`-наблюдателей:
`completed | disconnected | aborted | failed`. Формы io в декларации
(включая `multipart`) — [endpoints.md](./endpoints.md).

### Момент финализации

Для потоковой формы `output` исход честен только по факту доставки,
поэтому `.finally`-юниты выполняются **после** завершения отдачи потока:
когда он дотёк, оборвался ошибкой или был закрыт потребителем. Для
не-потоковых ответов момент прежний — сразу после ответной фазы.

Отсюда контракт с транспортом: получив потоковый ответ, транспорт обязан
либо потребить итератор до конца, либо закрыть его (`return()`) — в том
числе при ошибке отправки и при дисконнекте. Иначе финализация не
произойдёт. См. [transports.md](./transports.md).

Источник, закончившийся сам, даёт `completed` и для `events`;
`disconnected` — это завершение по взведённому сигналу дисконнекта.

### Mid-stream отказ

Заголовки уже ушли — статус сменить нельзя, поэтому ответ обязан быть
честным по framing'у:

- **NDJSON (`stream`)** — соединение обрывается: клиент видит незавершённый
  chunked-ответ, и это сигнал «данные неполны»;
- **SSE (`events`)** — уходит именованное событие `error` с телом отказа,
  после чего соединение закрывается. Имя `error` **зарезервировано**:
  прикладное событие с этим именем отвергается при создании декларации.

В обоих случаях `.finally` получает `failed`, а незадекларированный отказ
проходит ту же нормализацию в `UnknownError`, что и на обычном пути
([errors.md](./errors.md)). `.catch`-юниты mid-stream **не** вызываются:
ответный тракт уже завершён, и замена ответа физически невозможна.

## 3. Item-цепочки: второй скоуп обработки

У стримов **два разных пайплайна**: действия на весь запрос/соединение
(request-pipeline, [pipeline.md](./pipeline.md)) и действия на каждый
элемент. Это разные конструкции:

| | Request-scope | Item-scope (chunk/event) |
|---|---|---|
| Запускается | раз на запрос/соединение | на каждый элемент потока |
| Форма | фазы `.pre/.ok/.catch/.finally` | линейная цепочка комбинаторов, **фаз нет** |
| Где объявлен | `pipeline: compose(...)` | на io-декларации `stream()`/`events()` |
| Состояние | ctx | внутри цепочки; стандартные счётчики → `summary` |

```typescript
input: stream(LogChunk)
  .tap(c => log.debug(c.message))     // наблюдение
  .filter(c => c.level !== 'debug')   // T → T
  .limit(50_000)                      // Fail при превышении
  .gapTimeout(30_000)                 // разрыв при молчании
  .batch(100),                        // тип-меняющий: хендлер получит LogChunk[]

output: events(OrderEvent)
  .tap(e => metrics.inc('events_out'))
  .throttle(10),                      // только T → T
```

Правила:

- **Асимметрия входа и выхода** (следствие schema-first): входная цепочка
  может менять тип — она видимая часть контракта (схема описывает провод,
  результат цепочки — форму хендлера); выходная — только `T → T`: оба её
  конца зафиксированы схемой.
- **Тип-сохраняющее vs тип-меняющее**: наблюдение, лимиты, таймауты,
  фильтрация — инфраструктура; батчинг и обогащение — часть контракта,
  только там, где видимы в декларации.
- Ошибки цепочки эскалируют в request-pipeline: комбинатор бросил `Fail` →
  обычные `.catch`/`.finally`; если выход уже тёк — mid-stream политика
  транспорта + `finally(failed)`.
- `.limit(n)` и `.gapTimeout(ms)` отказывают встроенными определениями
  `STREAM_LIMIT_EXCEEDED` (413) и `STREAM_GAP_TIMEOUT` (504): это
  kernel-коды, поэтому страж границы не превращает штатный отказ лимита
  в `500 UNKNOWN` ([errors.md](./errors.md)).
- Фреймворк кладёт стандартные метрики (`itemsIn/itemsOut/bytes`) в
  `summary` для `finally`.

### Поэлементная валидация

Схема-лист описывает **провод**, поэтому валидация симметрична и
поэлементна: на входе элемент проверяется **до** цепочки, на выходе —
**после** неё (выходная цепочка `T → T`, так что оба её конца — провод).
Реализация — та же синхронная валидация, что у значений
([schemas.md](./schemas.md)), второй кодовой ветки нет.

Политика объявляется вторым аргументом формы, дефолт —
`{ validate: true, onInvalid: 'fail' }`:

```typescript
input: stream(LogChunk, { onInvalid: 'skip' }),  // невалидную строку отбросить
input: stream(Sample, { validate: false }),      // горячий путь: opt-out явный
```

- `onInvalid: 'fail'` — отказ `VALIDATION_FAILED` (400);
- `onInvalid: 'skip'` — элемент отбрасывается, в `itemsIn` не попадает;
- на **выходе** `onInvalid` игнорируется: невалидный элемент — всегда
  отказ (mid-stream политика). Тихо ронять данные из ответа фреймворк не
  будет.

Примитивный лист (`'binary'`/`'text'`) описывает байты — валидировать
нечего.

### `summary`

```typescript
interface StreamSummary {
  itemsIn: number; itemsOut: number;
  bytesIn?: number; bytesOut?: number;
}
```

Живой объект: создаётся вместе с контекстом, доступен как `ctx.summary`
любому юниту (не только `.finally`). Элементы считает рантайм цепочек —
`itemsIn` считает то, что действительно дошло до хендлера, поэтому
`.filter` его уменьшает; байты заполняет транспорт там, где знает их.
У не-потоковой ручки счётчики остаются нулями: поле есть всегда, чтобы
наблюдатель не ветвился.
- Переиспользование — функции-хелперы:
  `const guardedStream = (s) => stream(s).limit(50_000).gapTimeout(30_000)`.
- Escape hatch: `.through(src => wrapped)` — на входе можно с изменением
  типа, на выходе `T → T`.
- **Per-connection vs per-published-event**: item-цепочка работает на копии
  потока одного клиента (100 подписчиков → `.tap` сработает 100 раз на одно
  событие). Логика «один раз на публикацию» живёт у источника — в
  `Topic`/хабе, до всяких подписчиков.

## 4. Источники событий — это DI

Хендлер вызывается один раз **на соединение** и подписывается на источник —
обычный singleton-провайдер, живущий независимо от подписчиков:

```typescript
@Injectable([])
export class OrdersHub {
  #topic = new Topic<Order>({ buffer: 1000, onSlowConsumer: 'disconnect' });
  publish(order: Order) { this.#topic.push(order); }
  subscribe(signal: AbortSignal) { return this.#topic.subscribe(signal); }
}
```

`Topic` — маленький broadcast-примитив (bounded buffer + AbortSignal),
осознанно Subject-lite, а не парадигма. Живёт в отдельном пакете
`@nestling/streams` без внешних зависимостей: на него опираются и
конфигурация (`reloadable`, [config.md](./config.md)), и шина портов —
тянуть ради broadcast-примитива весь пайплайн неправильно.

```typescript
class Topic<T> {
  constructor(options?: { buffer?: number; onSlowConsumer?: 'drop-oldest' | 'disconnect' });
  push(value: T): void;                       // не ждёт подписчиков
  subscribe(signal?: AbortSignal): AsyncIterableIterator<T>;
  close(): void;                              // завершает все подписки
  get subscribers(): number;
}
```

Ключевое: **`push` не ждёт никогда**, а буфер — **per-подписчик**. Судьбу
отстающего решает политика, не останавливая остальных:

- `drop-oldest` (по умолчанию) — самый старый элемент буфера вытесняется,
  подписка живёт; число отброшенных элементов доступно как статистика;
- `disconnect` — подписка отстающего завершается, если потеря событий
  недопустима.

Подписка завершается тремя способами и в любом из них освобождает буфер и
снимается с темы: по взведённому `signal`, по `close()` темы и по выходу
потребителя из итерации (`break`/`return()`).

### 4.1 Реестр подписок

**Реестр подписок** — satellite-пакет `@nestling/subscriptions`, а не часть
ядра: посмотреть активные подписки, завершить конкретную и наблюдать ленту
изменений он умеет целиком поверх публичных примитивов (фазы
`.pre`/`.finally`, класс-форма юнита, `AbortSignal`, DI, `Topic` и
контракты). Ядро о нём не знает ни строкой — это проверяемое свойство, а не
пожелание.

Поверхность пакета:

```typescript
const appSubscriptions = subscriptions({          // параметризованный модуль
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                                  // факты контрактами, opt-in
  node: process.env.HOSTNAME,
});

export const Feed = httpEndpoint({
  method: 'GET',
  path: '/api/feed',
  output: events(Event),
  pipeline: compose(base, tracked),               // слой ставится композицией
  deps: [EventHub],
  handle: (hub: EventHub) => async (_payload, meta) =>
    new Ok(hub.subscribe(meta.subscription.signal)),
});

interface SubscriptionRegistry {
  list(filter?: SubscriptionFilter): readonly SubscriptionInfo[];
  get(id: string): SubscriptionInfo | undefined;
  abort(id: string, reason?: string): boolean;
  abortAll(filter?: SubscriptionFilter, reason?: string): number;
  watch(signal?: AbortSignal): AsyncIterableIterator<SubscriptionEvent>;
  get size(): number;
}
```

Свойства, важные для модели:

- **Административный канал — второе поле, а не `meta.signal`.** Ключ
  `signal` зарезервирован пайплайном, и слой его не перекрывает: `meta.signal`
  остаётся сигналом *запроса*, а `meta.subscription.signal` комбинирует его с
  контроллером записи.
- **Свой словарь причин закрытия:** `CloseReason = Outcome | 'killed'`.
  Пайплайн административное завершение выразить не может — его
  `computeOutcome` смотрит на сигнал запроса, — поэтому для наблюдателей
  ядра убитая подписка честно выглядит как `completed`, а реестр говорит
  `killed` своим словарём. `Outcome` ядра пятым значением **не**
  расширяется.
- **Снятие записи — обычным путём.** `abort()` только взводит сигнал;
  запись снимает `.finally`, когда поток действительно закончился. Реестр
  отражает факт, а не опережает его.
- **Node-local управление, кластерное наблюдение.** `list()`/`abort()`
  действуют в своём процессе; `event`-контракты `subscriptions.opened` /
  `subscriptions.closed` (opt-in) несут имя узла, поэтому картина по
  кластеру собирается приёмником фактов. Кластерного kill в V1 нет —
  см. [deferred.md](../decisions/deferred.md).
- **Вездесущность слоя — политикой, а не ambient-механизмом:**
  `everyEndpoint({ … }).hasLayer(tracked)` ([composition.md](./composition.md)).

Гайд: [guides/subscriptions.md](../guides/subscriptions.md).

## 5. Граница с RxJS

Nestling **не зависит от RxJS и не навязывает его** (урок Nest-интерцепторов),
но Rx полностью доступен внутри хендлера как обычная зависимость приложения.

Правило-лакмус:

| Задача | Инструмент |
|---|---|
| Наблюдение, лимиты, таймауты, фильтрация | item-цепочка — Rx не нужен |
| Простая поэлементная обработка | `for await` в хендлере — Rx не нужен |
| **Окна и агрегация по времени** (`bufferTime`, `debounceTime`) | RxJS в хендлере |
| **Слияние нескольких потоков** (`merge`, `combineLatest`, `zip`) | RxJS в хендлере |
| **Higher-order streams** (`switchMap`, `exhaustMap`) | RxJS в хендлере |

Если логика — про *время* или про *несколько потоков сразу*, это
dataflow-программирование: фреймворк туда не лезет. Комбинаторы с
реордерингом времени, слиянием потоков и higher-order streams в словарь
item-цепочек **не входят** — словарь закрытый и инфраструктурный.

### Мостики

```typescript
import { from } from 'rxjs';                    // AsyncIterable → Observable
import { eachValueFrom } from 'rxjs-for-await'; // Observable → AsyncIterable
```

Отмена сшивается автоматически: клиент отвалился → `for await` по выходному
итератору завершается → `eachValueFrom` отписывается → `from()` перестаёт
тянуть вход; `meta.signal` дополнительно закрывает подписки на источники.

### Пример: окна по времени (хендлер без зависимостей)

Клиент льёт поток метрик (NDJSON), ответ — агрегаты по секундным окнам.
На голых итераторах «окно по времени» — гонка таймера против
`iterator.next()`; в Rx — один оператор.

```typescript
const MetricPoint = z.object({ name: z.string(), value: z.number(), ts: z.number() });
const WindowAggregate = z.object({
  count: z.number(), avg: z.number(), max: z.number(), windowEnd: z.iso.datetime(),
});

export const AggregateMetrics = httpEndpoint({
  method: 'POST',
  path: '/metrics/aggregate',
  input: guardedStream(MetricPoint),   // item-цепочка: лимиты/таймауты — без Rx
  output: stream(WindowAggregate),
  pipeline: base,
  handle: async function* (points: AsyncIterableIterator<MetricPoint>) {
    const aggregates$ = from(points).pipe(   // ← граница: AsyncIterable → Observable
      bufferTime(1_000),
      filter(batch => batch.length > 0),
      map(summarize),
    );
    yield* eachValueFrom(aggregates$);       // ← граница: Observable → AsyncIterable
  },
});
```

### Пример: слияние двух хабов (DI, класс-хендлер)

```typescript
@Injectable([OrdersHub, PaymentsHub])
export class ActivityFeedHandler {
  constructor(
    private readonly orders: OrdersHub,
    private readonly payments: PaymentsHub,
  ) {}

  async *handle(_: undefined, meta: { signal: AbortSignal }) {
    const feed$ = merge(
      from(this.orders.subscribe(meta.signal)).pipe(map(orderToActivity)),
      from(this.payments.subscribe(meta.signal)).pipe(map(paymentToActivity)),
    ).pipe(throttleTime(200, undefined, { leading: true, trailing: true }));

    yield* eachValueFrom(feed$);
  }
}

export const ActivityFeed = httpEndpoint({
  method: 'GET',
  path: '/activity/live',
  output: events(ActivityEvent).tap(e => console.debug('out:', e.kind)),
  pipeline: base,
  handle: ActivityFeedHandler,       // класс-хендлер: App резолвит из контейнера
});
```

Границы скоупов здесь физические: `hub.publish()` — точка
per-published-event; `handle()` — per-connection (каждый подписчик получает
свой `merge` и троттлинг); `.tap()` на `events()` — item-цепочка
per-connection.

Тест — без фреймворка, только протокол async-итерации:

```typescript
const handler = new ActivityFeedHandler(fakeOrdersHub, fakePaymentsHub);
const controller = new AbortController();
for await (const e of handler.handle(undefined, { signal: controller.signal })) {
  events.push(e);
  if (events.length === 3) controller.abort();
}
```

### Оговорка про backpressure

Внутри Rx-острова pull-семантика теряется: Observable пушит, `eachValueFrom`
копит непотреблённые значения в очередь. Для операторов, **сжимающих** поток
(окна, троттлинг, дебаунс), это не проблема — они для того и стоят. Поток
один-к-одному без сжатия через Rx-остров на медленном клиенте растит буфер.
Правило: заходишь в Rx — убедись, что выход не плотнее входа, либо ограничь
его (`throttleTime`, `bufferTime`, `sample`).
