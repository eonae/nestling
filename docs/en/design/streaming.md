# Streaming: `stream` and `events`, item chains, the boundary with RxJS

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-06] Стриминг: stream(T) ≠ events(T), AbortSignal, источники событий`,
> `[2026-07-06] Два скоупа обработки: request-pipeline и item-цепочки`
> (there — "Are we reinventing RxJS?"),
> `[2026-07-13] Операция первичен` (io shapes),
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-09-03] Код отказа: категория и уточнение; makeFail`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. Boundaries: the standard `AsyncIterable`

Every streaming boundary of the framework uses the standard protocol
of the language, not a proprietary type. An input stream arrives at
the handler as `AsyncIterableIterator<T>`. A streaming response is
given out by the handler through `yield` from an async generator. A
subscription to an event source (`Topic`) is also an `AsyncIterable`.
This is a pull model: the consumer itself requests the next item, so a
slow client does not accumulate data on the server (backpressure).

Cancellation runs through end to end. The transport arms `meta.signal`
when the client disconnects; the application arms it when it stops.
The handler must watch the signal itself. With `for await` over a
subscription that accepts a signal, this happens by itself.

The `signal` key in `meta` is reserved by the pipeline
(`request-abort-signal`), so the third reason for cancellation — an
administrative termination of the subscription — travels through a
separate field. The `tracked` layer of the subscription registry puts
into `meta.subscription.signal` the combination
`AbortSignal.any([the request signal, the administrative controller])`
([§4.1](#41-subscription-registry)). The handler of a tracked endpoint
listens to `meta.subscription.signal` and gets all three reasons
through one subscription. The handler of an ordinary endpoint listens
to `meta.signal`.

## 2. `stream(T)` and `events(T)`

| | `stream(T)` | `events(T)` |
|---|---|---|
| Nature | finite data (an export, a large result) | an open subscription |
| End | natural (the data ran out) | none; "normal completion" means a disconnect |
| HTTP framing | NDJSON / chunked | SSE: heartbeat, `id:`, reconnect by `Last-Event-ID` |
| Normal outcome | `completed` | `disconnected` |
| Docs | OpenAPI | AsyncAPI |

The set of outcomes for `.finally` observers:
`completed | disconnected | aborted | failed`. The io shapes in a
declaration, including `multipart`, are described in
[endpoints.md](./endpoints.md).

### A streaming shape is declared as the only outcome

`stream(...)` and `events(...)` stand alone in the `output` slot: a
streaming shape is not declared as a branch of `outputs({ … })`
([endpoints.md §5](./endpoints.md)).

The reason is that the settings of a streaming response are read before
the handler runs, when the outcome is not known yet. The transport puts
`last-event-id` into the start context while parsing the request, the
`sse` section is declared with `events(...)`, the output item chain is
attached by the shape of the declaration, and the capability check
matches one shape against the transport. An endpoint that answers with a
stream in one case and an object in another is described by two
addresses.

### The moment of finalization

For a streaming `output`, the outcome is known only after delivery, so
`.finally` steps run after the delivery of the stream is finished:
when the stream ended, broke with an error, or was closed by the
consumer. For a non-streaming response, the moment stays the same —
right after the response phase.

Hence the requirement on the transport: once it gets a streaming
response, it must either read the iterator to the end or close it
through `return()`. This covers both a delivery error and a client
disconnect. Otherwise finalization does not happen. More detail is in
[transports.md](./transports.md).

The number of items read does not affect finalization. Closing the
iterator before the first item runs `.finally` the same way as closing
it in the middle of the stream, and it reaches the source the handler
returned: the subscription that took a slot at the moment of the call
is removed. An observer reads how many items reached the client from
`ctx.summary.itemsOut`.

If the source ended by itself, the `completed` outcome happens for
`events` too. `disconnected` means finishing by an armed disconnect
signal.

### A mid-stream failure

By this moment the headers are already sent, and the status cannot
change. So the response must stay correct from the point of view of
framing:

- NDJSON (`stream`): the connection breaks. The client sees an
  unfinished chunked response and understands that the data is
  incomplete.
- SSE (`events`): a named `error` event is sent with the body of the
  failure, after which the connection closes. The name `error` is
  reserved: an application event with this name is rejected when the
  declaration is created.

In both cases `.finally` gets `failed`, and an undeclared failure is
normalized into `InternalError` the same way as on the ordinary path
([errors.md](./errors.md)). `.catch` steps are not called mid-stream:
the response phase has already finished, and the response cannot be
replaced.

## 3. Item chains: the second level of processing

Streams have two different levels of processing: actions over the
whole request or connection (the request pipeline,
[pipeline.md](./pipeline.md)) and actions on every item. These are
different constructs:

| | Request scope | Item scope (chunk/event) |
|---|---|---|
| Runs | once per request/connection | on every item of the stream |
| Shape | the `.pre/.ok/.catch/.finally` phases | a linear chain of combinators, no phases |
| Declared at | `pipeline: compose(...)` | on the `stream()`/`events()` io declaration |
| State | ctx | inside the chain; standard counters → `summary` |

```typescript
input: stream(LogChunk)
  .tap(c => log.debug(c.message))     // observation
  .filter(c => c.level !== 'debug')   // T → T
  .limit(50_000)                      // fails on overflow
  .gapTimeout(30_000)                 // breaks on silence
  .batch(100),                        // type-changing: the handler gets LogChunk[]

output: events(OrderEvent)
  .tap(e => metrics.inc('events_out'))
  .throttle(10),                      // only T → T
```

- An input chain may change the type, an output chain only goes
  `T → T`. The input chain is the visible part of the operation: the
  schema describes the data on the network, and the result of the
  chain is what the handler gets. For an output chain, both ends are
  fixed by the `output` schema.
- Observation, limits, timeouts and filtering keep the type and belong
  to infrastructure. Batching and enrichment change the type and are
  part of the operation: they are allowed only where they are visible
  in the declaration.
- An error of the chain rises into the request pipeline: a combinator
  threw a `Fail`, and after that the ordinary `.catch` and `.finally`
  run. If output was already delivered to the client, the transport
  policy for a mid-stream failure applies, and `.finally` gets
  `failed`.
- `.limit(n)` and `.gapTimeout(ms)` fail with the built-in categories
  `payload_too_large` (413) and `timeout` (504). These are kernel
  categories: the `errors` check on the way out of the pipeline lets
  them through and does not turn them into `500 internal_error`
  ([errors.md](./errors.md)).
- The framework keeps standard counters (`itemsIn`, `itemsOut`,
  `bytes`) in `summary`, which is available to `.finally`.
- Chains are reused through functions: `const guardedStream = (s) =>
  stream(s).limit(50_000).gapTimeout(30_000)`.
- `.through(src => wrapped)` accepts an arbitrary iterator wrapper: on
  input it may change the type, on output it is `T → T`. The wrapper
  must acquire resources inside the body of the iteration, not at
  creation: closing a stream that was never read goes past the steps
  of the chain — straight to the source of the handler.
- An item chain works on the copy of the stream of one client: with
  100 subscribers, `.tap` fires 100 times for one event. The logic of
  "once per publication" lives at the source — in `Topic` or a hub,
  before the subscribers.

### Per-item validation

The leaf schema describes the data on the network, so items on the
input are checked before the chain, and on the output after it. The
same synchronous validation is used as for ordinary values
([schemas.md](./schemas.md)); there is no separate code branch for
streams.

The policy is set by the second argument of the shape; the default is
`{ validate: true, onInvalid: 'fail' }`:

```typescript
input: stream(LogChunk, { onInvalid: 'skip' }),  // drop an invalid line
input: stream(Sample, { validate: false }),      // a hot path: opt-out is explicit
```

- `onInvalid: 'fail'` — a `bad_request` failure (400);
- `onInvalid: 'skip'` — the item is dropped and does not go into
  `itemsIn`;
- on the output, `onInvalid` is not taken into account: an invalid
  item always gives a failure by the rules of a mid-stream failure.

A primitive leaf (`'binary'`/`'text'`) describes bytes; there is
nothing in it to check.

### `summary`

```typescript
interface StreamSummary {
  itemsIn: number; itemsOut: number;
  bytesIn?: number; bytesOut?: number;
}
```

The object is created together with the context and is available as
`ctx.summary` to any step, not only `.finally`. The chain runtime
counts items: `itemsIn` counts what reached the handler, so `.filter`
reduces it. The transport fills in the bytes, if it knows them. For a
non-streaming endpoint, the counters stay at zero: the field exists on
any endpoint, so an observer does not need to check whether it is
present.

## 4. Event sources

The handler is called once per connection and subscribes to a source.
A source is an ordinary singleton provider that lives independently of
its subscribers:

```typescript
@Component()
export class OrdersHub {
  #topic = new Topic<Order>({ buffer: 1000, onSlowConsumer: 'disconnect' });
  publish(order: Order) { this.#topic.push(order); }
  subscribe(signal: AbortSignal) { return this.#topic.subscribe(signal); }
}
```

`Topic` is a small broadcast primitive: a bounded buffer plus
`AbortSignal`. It lives in the `@nestlingjs/operations` package, which
has no external dependencies; the configuration (`reloadable`,
[config.md](./config.md)) and the bus of the ports rest on it too.

```typescript
class Topic<T> {
  constructor(options?: { buffer?: number; onSlowConsumer?: 'drop-oldest' | 'disconnect' });
  push(value: T): void;                       // does not wait for subscribers
  subscribe(signal?: AbortSignal): AsyncIterableIterator<T>;
  close(): void;                              // ends every subscription
  get subscribers(): number;
}
```

`push` never waits for subscribers. Every subscription has its own
buffer. A policy decides what to do with a lagging subscriber, and it
does not affect the rest of the subscribers:

- `drop-oldest` (the default) — the oldest item of the buffer is
  evicted, the subscription keeps working; the number of dropped items
  is available as a statistic;
- `disconnect` — the subscription of the lagging consumer ends. This
  fits when losing events is not acceptable.

A subscription ends in three ways: by an armed `signal`, by `close()`
of the topic, and by the consumer leaving the iteration (`break` or
`return()`). In every case it frees the buffer and is removed from the
topic.

### 4.1 Subscription registry

The subscription registry is the `@nestlingjs/subscriptions` package,
a satellite of the kernel. It shows the active subscriptions, ends a
specific one and gives out a feed of changes. The package is built
entirely on public primitives: the `.pre`/`.finally` phases, the class
shape of a step, `AbortSignal`, DI, `Topic` and operations. The kernel
does not know about it.

The surface of the package:

```typescript
const subscriptions = makeSubscriptions({         // a parameterized module
  identity: RequestId,                            // a variable names the subscriber
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                                  // facts as operations, opt-in
  node: process.env.HOSTNAME,
});

export const Feed = httpEndpoint.get('/api/feed', {
  output: events(Event),
  pipeline: compose(traced, tracked),             // the layer is put in by composition
  handler: {
    deps: [EventHub],
    handle: (hub: EventHub) => async (_payload, meta) =>
      new Ok(hub.subscribe(meta.subscription.signal)),
  },
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

Properties important for the model:

- The administrative channel is a separate field, not `meta.signal`.
  The `signal` key is reserved by the pipeline, and the layer does not
  override it: `meta.signal` stays the signal of the request, and
  `meta.subscription.signal` combines it with the controller of the
  registry entry.
- The registry has its own set of closing reasons:
  `CloseReason = Outcome | 'killed'`. The pipeline computes `outcome`
  from the request signal, so to kernel observers a killed
  subscription looks like `completed`; the registry reports `killed`.
  The kernel's `Outcome` is not extended with the `killed` value.
- An entry is removed the ordinary way. `abort()` only arms the
  signal; `.finally` removes the entry once the stream has really
  finished.
- Control is local to the node, observation spans the cluster.
  `list()` and `abort()` act in their own process. The `event`
  operations `subscriptions.opened` and `subscriptions.closed`
  (opt-in) carry the name of the node, so a receiver of these events
  builds the picture across the cluster. V1 has no cluster-wide
  termination of subscriptions — see
  [deferred.md](../../decisions/deferred.md).
- A context variable names the subscriber, not a read of the
  accumulated input. The registry takes the value by the key of the
  variable and does not know the shape of `input`, neither in types nor
  at runtime; when there is no value, the entry appears without
  `identity`. That every tracked endpoint puts the variable in is
  required by the `everyEndpoint({ … }).hasVar(…)` policy. The second
  shape of the option is a function of the context: its accumulated
  input is empty, and the values of several variables come to it as
  arguments from `computed([TenantId, UserId], (_ctx, tenant, user) =>
  …)`.
- Whether the layer is mandatory is set by a policy, not by a hidden
  mechanism: `everyEndpoint({ … }).hasLayer(tracked)`
  ([composition.md](./composition.md)).

Guide: the recipe
[Who is connected right now and how to disconnect them](../recipes/ops.md).

## 5. The boundary with RxJS

Nestling does not depend on RxJS and does not require it. Inside a
handler, RxJS is available as an ordinary dependency of the
application.

How to choose the tool:

| Task | Tool |
|---|---|
| Observation, limits, timeouts, filtering | an item chain — Rx is not needed |
| Per-item processing | `for await` in the handler — Rx is not needed |
| Windows and aggregation over time (`bufferTime`, `debounceTime`) | RxJS in the handler |
| Merging several streams (`merge`, `combineLatest`, `zip`) | RxJS in the handler |
| Higher-order streams (`switchMap`, `exhaustMap`) | RxJS in the handler |

Logic about time, or about several streams at once, is dataflow
programming, and it lives in the handler. Combinators with time-based
reordering, stream merging and higher-order streams are not part of
the set of item chains: the set is closed and infrastructural.

### Bridges

```typescript
import { from } from 'rxjs';                    // AsyncIterable → Observable
import { eachValueFrom } from 'rxjs-for-await'; // Observable → AsyncIterable
```

Cancellation runs through the bridges automatically: the client
disconnects, `for await` over the output iterator finishes,
`eachValueFrom` unsubscribes, `from()` stops pulling the input.
`meta.signal` additionally closes the subscriptions to the sources.

### Example: time windows (a handler with no dependencies)

The client sends a stream of metrics (NDJSON), the response is
aggregates over one-second windows. With bare iterators, a time window
needs a race between a timer and `iterator.next()`; in RxJS it is one
operator.

```typescript
const MetricPoint = z.object({ name: z.string(), value: z.number(), ts: z.number() });
const WindowAggregate = z.object({
  count: z.number(), avg: z.number(), max: z.number(), windowEnd: z.iso.datetime(),
});

export const AggregateMetrics = httpEndpoint.post('/metrics/aggregate', {
  input: guardedStream(MetricPoint),   // item chain: limits/timeouts — no Rx
  output: stream(WindowAggregate),
  pipeline: traced,
  handler: async function* (points: AsyncIterableIterator<MetricPoint>) {
    const aggregates$ = from(points).pipe(   // boundary: AsyncIterable → Observable
      bufferTime(1_000),
      filter(batch => batch.length > 0),
      map(summarize),
    );
    yield* eachValueFrom(aggregates$);       // boundary: Observable → AsyncIterable
  },
});
```

### Example: merging two hubs (DI, a class handler)

```typescript
@Handler([OrdersHub, PaymentsHub])
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

export const ActivityFeed = httpEndpoint.get('/activity/live', {
  output: events(ActivityEvent).tap(e => console.debug('out:', e.kind)),
  pipeline: traced,
  handler: ActivityFeedHandler,      // a class handler: the endpoint creates the instance itself
});
```

The boundaries of the levels are visible in the code here.
`hub.publish()` runs once per publication. `handle()` runs on every
connection: every subscriber gets its own `merge` and its own
throttling. `.tap()` on `events()` is an item chain, also on every
connection.

The test needs no framework, only the async iteration protocol:

```typescript
const handler = new ActivityFeedHandler(fakeOrdersHub, fakePaymentsHub);
const controller = new AbortController();
for await (const e of handler.handle(undefined, { signal: controller.signal })) {
  events.push(e);
  if (events.length === 3) controller.abort();
}
```

### A note about backpressure

Inside RxJS, pull semantics is lost: the Observable sends values
itself, and `eachValueFrom` puts the unconsumed values into a queue.
For operators that compress the stream (windows, throttling,
debounce), this is not a problem: that is what they are for. A
one-to-one stream with no compression grows a queue on a slow client.
The rule: the output of an RxJS section must not be denser than its
input; otherwise limit it with `throttleTime`, `bufferTime` or
`sample`.
