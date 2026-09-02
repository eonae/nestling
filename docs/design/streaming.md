# Стриминг: `stream`/`events`, item-цепочки, граница с RxJS

> **Целевое состояние V1.** Логика решений: [ideas.md](../decisions/ideas.md) —
> «Стриминг: `stream(T)` ≠ `events(T)`, AbortSignal, источники событий»
> [2026-07-06], «Два скоупа обработки: request-pipeline и item-цепочки»
> [2026-07-06] (там же — «Не переизобретаем ли мы RxJS?»), «Операция
> первичен» [2026-07-13] (формы io),
> «Стиль документации: правила, глоссарий, перенос обоснований из `design/`» [2026-08-29].
> Статус реализации —
> [roadmap](../decisions/roadmap.md).

## 1. Границы: стандартный `AsyncIterable`

Все потоковые границы фреймворка используют стандартный протокол языка, а
не собственный тип. Входной поток приходит в хендлер как
`AsyncIterableIterator<T>`. Потоковый ответ хендлер отдаёт через `yield`
из async-генератора. Подписка на источник событий (`Topic`) — тоже
`AsyncIterable`. Это pull-модель: потребитель сам запрашивает следующий
элемент, поэтому медленный клиент не накапливает данные на сервере
(backpressure).

Отмена сквозная. Транспорт взводит `meta.signal`, когда клиент
отключается; приложение взводит его при остановке. Хендлер обязан сам
следить за сигналом. При `for await` по подписке, которая принимает
сигнал, это происходит само.

Ключ `signal` в `meta` зарезервирован пайплайном
(`request-abort-signal`), поэтому третья причина отмены —
административное завершение подписки — передаётся отдельным полем. Слой
`tracked` реестра подписок кладёт в `meta.subscription.signal` комбинацию
`AbortSignal.any([сигнал запроса, административный контроллер])`
([§4.1](#41-реестр-подписок)). Хендлер отслеживаемого endpoint'а слушает
`meta.subscription.signal` и получает все три причины через одну подписку.
Хендлер обычного endpoint'а слушает `meta.signal`.

## 2. `stream(T)` и `events(T)`

| | `stream(T)` | `events(T)` |
|---|---|---|
| Природа | конечные данные (экспорт, большой результат) | открытая подписка |
| Конец | естественный (данные закончились) | нет; «нормальное завершение» = дисконнект |
| HTTP-framing | NDJSON / chunked | SSE: heartbeat, `id:`, реконнект по `Last-Event-ID` |
| Нормальный исход | `completed` | `disconnected` |
| Доки | OpenAPI | AsyncAPI |

Набор исходов для `.finally`-наблюдателей:
`completed | disconnected | aborted | failed`. Формы io в декларации,
включая `multipart`, описаны в [endpoints.md](./endpoints.md).

### Момент финализации

У потокового `output` исход известен только после доставки, поэтому
`.finally`-юниты выполняются после завершения отдачи потока: когда поток
закончился, оборвался ошибкой или был закрыт потребителем. У непотокового
ответа момент прежний — сразу после ответной фазы.

Отсюда требование к транспорту: получив потоковый ответ, он обязан либо
прочитать итератор до конца, либо закрыть его через `return()`. Это
касается и ошибки отправки, и отключения клиента. Иначе финализация не
произойдёт. Подробнее — в [transports.md](./transports.md).

Если источник закончился сам, исход `completed` наступает и для `events`.
`disconnected` означает завершение по взведённому сигналу отключения.

### Отказ посреди потока (mid-stream)

Заголовки к этому моменту уже отправлены, и сменить статус нельзя. Поэтому
ответ должен остаться корректным с точки зрения framing:

- NDJSON (`stream`): соединение обрывается. Клиент видит незавершённый
  chunked-ответ и понимает, что данные неполны.
- SSE (`events`): отправляется именованное событие `error` с телом отказа,
  после чего соединение закрывается. Имя `error` зарезервировано:
  прикладное событие с таким именем отвергается при создании декларации.

В обоих случаях `.finally` получает `failed`, а незадекларированный отказ
нормализуется в `UnknownError` так же, как на обычном пути
([errors.md](./errors.md)). `.catch`-юниты посреди потока не вызываются:
ответная фаза уже завершена, и заменить ответ невозможно.

## 3. Item-цепочки: второй уровень обработки

У потоков два разных уровня обработки: действия на весь запрос или
соединение (пайплайн запроса, [pipeline.md](./pipeline.md)) и действия на
каждый элемент. Это разные конструкции:

| | Request-scope | Item-scope (chunk/event) |
|---|---|---|
| Запускается | раз на запрос/соединение | на каждый элемент потока |
| Форма | фазы `.pre/.ok/.catch/.finally` | линейная цепочка комбинаторов, фаз нет |
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

- Входная цепочка может менять тип, выходная — только `T → T`. Входная
  цепочка — видимая часть операции: схема описывает данные в сети, а
  результат цепочки — то, что получает хендлер. У выходной цепочки оба
  конца зафиксированы схемой `output`.
- Наблюдение, лимиты, таймауты и фильтрация сохраняют тип и относятся к
  инфраструктуре. Батчинг и обогащение меняют тип и являются частью
  операции: они допустимы только там, где видны в декларации.
- Ошибка цепочки поднимается в пайплайн запроса: комбинатор бросил `Fail`,
  и дальше работают обычные `.catch` и `.finally`. Если выход уже
  передавался клиенту, действует политика транспорта для отказа посреди
  потока, а `.finally` получает `failed`.
- `.limit(n)` и `.gapTimeout(ms)` отказывают встроенными определениями
  `STREAM_LIMIT_EXCEEDED` (413) и `STREAM_GAP_TIMEOUT` (504). Это
  kernel-коды: проверка `errors` на выходе из пайплайна пропускает их и не
  превращает в `500 UNKNOWN` ([errors.md](./errors.md)).
- Фреймворк ведёт стандартные счётчики (`itemsIn`, `itemsOut`, `bytes`) в
  `summary`, который доступен `.finally`.
- Цепочки переиспользуются через функции:
  `const guardedStream = (s) => stream(s).limit(50_000).gapTimeout(30_000)`.
- `.through(src => wrapped)` принимает произвольную обёртку итератора: на
  входе с изменением типа, на выходе `T → T`.
- Item-цепочка работает на копии потока одного клиента: при 100
  подписчиках `.tap` сработает 100 раз на одно событие. Логика «один раз
  на публикацию» живёт у источника — в `Topic` или хабе, до подписчиков.

### Поэлементная валидация

Схема-лист описывает данные в сети, поэтому элементы проверяются на входе
до цепочки, а на выходе — после неё. Используется та же синхронная
валидация, что и для обычных значений ([schemas.md](./schemas.md));
отдельной ветки кода для потоков нет.

Политика задаётся вторым аргументом формы; по умолчанию
`{ validate: true, onInvalid: 'fail' }`:

```typescript
input: stream(LogChunk, { onInvalid: 'skip' }),  // невалидную строку отбросить
input: stream(Sample, { validate: false }),      // горячий путь: opt-out явный
```

- `onInvalid: 'fail'` — отказ `VALIDATION_FAILED` (400);
- `onInvalid: 'skip'` — элемент отбрасывается и в `itemsIn` не попадает;
- на выходе `onInvalid` не учитывается: невалидный элемент всегда даёт
  отказ по правилам отказа посреди потока.

Примитивный лист (`'binary'`/`'text'`) описывает байты; проверять в нём
нечего.

### `summary`

```typescript
interface StreamSummary {
  itemsIn: number; itemsOut: number;
  bytesIn?: number; bytesOut?: number;
}
```

Объект создаётся вместе с контекстом и доступен как `ctx.summary` любому
юниту, не только `.finally`. Элементы считает рантайм цепочек: `itemsIn`
учитывает то, что дошло до хендлера, поэтому `.filter` уменьшает его.
Байты заполняет транспорт, если знает их. У непотокового endpoint'а
счётчики остаются нулями: поле есть у любого endpoint'а, чтобы
наблюдателю не приходилось проверять его наличие.

## 4. Источники событий

Хендлер вызывается один раз на соединение и подписывается на источник.
Источник — обычный singleton-провайдер, который живёт независимо от
подписчиков:

```typescript
@Injectable([])
export class OrdersHub {
  #topic = new Topic<Order>({ buffer: 1000, onSlowConsumer: 'disconnect' });
  publish(order: Order) { this.#topic.push(order); }
  subscribe(signal: AbortSignal) { return this.#topic.subscribe(signal); }
}
```

`Topic` — небольшой broadcast-примитив: ограниченный буфер плюс
`AbortSignal`. Он живёт в пакете `@nestling/streams` без внешних
зависимостей; на него опираются также конфигурация (`reloadable`,
[config.md](./config.md)) и шина портов.

```typescript
class Topic<T> {
  constructor(options?: { buffer?: number; onSlowConsumer?: 'drop-oldest' | 'disconnect' });
  push(value: T): void;                       // не ждёт подписчиков
  subscribe(signal?: AbortSignal): AsyncIterableIterator<T>;
  close(): void;                              // завершает все подписки
  get subscribers(): number;
}
```

`push` никогда не ждёт подписчиков. Буфер у каждой подписки свой. Что
делать с отстающим подписчиком, решает политика, и остальных подписчиков
она не затрагивает:

- `drop-oldest` (по умолчанию) — самый старый элемент буфера вытесняется,
  подписка продолжает работать; число отброшенных элементов доступно как
  статистика;
- `disconnect` — подписка отстающего завершается. Подходит, когда терять
  события недопустимо.

Подписка завершается тремя способами: по взведённому `signal`, по
`close()` темы и по выходу потребителя из итерации (`break` или
`return()`). В любом случае она освобождает буфер и снимается с темы.

### 4.1 Реестр подписок

Реестр подписок — пакет `@nestling/subscriptions`, satellite ядра. Он
показывает активные подписки, завершает конкретную и отдаёт ленту
изменений. Пакет построен целиком на публичных примитивах: фазах
`.pre`/`.finally`, класс-форме юнита, `AbortSignal`, DI, `Topic` и
операциях. Ядро о нём не знает.

Поверхность пакета:

```typescript
const appSubscriptions = subscriptions({          // параметризованный модуль
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                                  // факты операциями, opt-in
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

- Административный канал — отдельное поле, а не `meta.signal`. Ключ
  `signal` зарезервирован пайплайном, и слой его не перекрывает:
  `meta.signal` остаётся сигналом запроса, а `meta.subscription.signal`
  объединяет его с контроллером записи реестра.
- У реестра свой набор причин закрытия: `CloseReason = Outcome | 'killed'`.
  Пайплайн вычисляет `outcome` по сигналу запроса, поэтому для
  наблюдателей ядра убитая подписка выглядит как `completed`; реестр
  сообщает `killed`. `Outcome` ядра значением `killed` не расширяется.
- Запись снимается обычным путём. `abort()` только взводит сигнал; запись
  удаляет `.finally`, когда поток действительно завершился.
- Управление локально для узла, наблюдение — по кластеру. `list()` и
  `abort()` действуют в своём процессе. `event`-операции
  `subscriptions.opened` и `subscriptions.closed` (opt-in) несут имя
  узла, поэтому картину по кластеру собирает приёмник этих событий.
  Кластерного завершения подписок в V1 нет — см.
  [deferred.md](../decisions/deferred.md).
- Обязательность слоя задаётся политикой, а не скрытым механизмом:
  `everyEndpoint({ … }).hasLayer(tracked)` ([composition.md](./composition.md)).

Гайд: [guides/subscriptions.md](../guides/subscriptions.md).

## 5. Граница с RxJS

Nestling не зависит от RxJS и не требует его. Внутри хендлера RxJS
доступен как обычная зависимость приложения.

Как выбрать инструмент:

| Задача | Инструмент |
|---|---|
| Наблюдение, лимиты, таймауты, фильтрация | item-цепочка — Rx не нужен |
| Простая поэлементная обработка | `for await` в хендлере — Rx не нужен |
| Окна и агрегация по времени (`bufferTime`, `debounceTime`) | RxJS в хендлере |
| Слияние нескольких потоков (`merge`, `combineLatest`, `zip`) | RxJS в хендлере |
| Higher-order streams (`switchMap`, `exhaustMap`) | RxJS в хендлере |

Логика про время или про несколько потоков сразу — это
dataflow-программирование, и оно живёт в хендлере. Комбинаторы с
переупорядочиванием по времени, слиянием потоков и higher-order streams в
набор item-цепочек не входят: набор закрытый и инфраструктурный.

### Мостики

```typescript
import { from } from 'rxjs';                    // AsyncIterable → Observable
import { eachValueFrom } from 'rxjs-for-await'; // Observable → AsyncIterable
```

Отмена проходит через мостики автоматически: клиент отключился, `for
await` по выходному итератору завершается, `eachValueFrom` отписывается,
`from()` перестаёт тянуть вход. `meta.signal` дополнительно закрывает
подписки на источники.

### Пример: окна по времени (хендлер без зависимостей)

Клиент отправляет поток метрик (NDJSON), ответ — агрегаты по секундным
окнам. На голых итераторах окно по времени требует гонки таймера с
`iterator.next()`; в RxJS это один оператор.

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
    const aggregates$ = from(points).pipe(   // граница: AsyncIterable → Observable
      bufferTime(1_000),
      filter(batch => batch.length > 0),
      map(summarize),
    );
    yield* eachValueFrom(aggregates$);       // граница: Observable → AsyncIterable
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

Границы уровней здесь видны в коде. `hub.publish()` выполняется один раз
на публикацию. `handle()` выполняется на каждое соединение: каждый
подписчик получает свой `merge` и свой троттлинг. `.tap()` на `events()` —
item-цепочка, тоже на каждое соединение.

Тест не требует фреймворка, только протокол async-итерации:

```typescript
const handler = new ActivityFeedHandler(fakeOrdersHub, fakePaymentsHub);
const controller = new AbortController();
for await (const e of handler.handle(undefined, { signal: controller.signal })) {
  events.push(e);
  if (events.length === 3) controller.abort();
}
```

### Оговорка про backpressure

Внутри RxJS pull-семантика теряется: Observable отправляет значения сам,
а `eachValueFrom` складывает непотреблённые значения в очередь. Для
операторов, которые сжимают поток (окна, троттлинг, дебаунс), это не
проблема: они для того и нужны. Поток один-к-одному без сжатия на
медленном клиенте растит очередь. Правило: выход из RxJS-участка не должен
быть плотнее входа; иначе его ограничивают `throttleTime`, `bufferTime`
или `sample`.
