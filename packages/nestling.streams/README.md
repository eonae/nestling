# @nestling/streams

Stream primitives for Nestling: `Topic<T>` (a broadcast source of events),
the implementation of the closed **item-chain** combinator vocabulary
(`tap`, `filter`, `limit`, `gapTimeout`, `throttle`, `batch`, `through`)
and iteration helpers driven by `AbortSignal`.

The package has **no dependencies** — not even on `@nestling/pipeline`.
That is deliberate: `Topic` is what the config module builds `reloadable`
on and what the in-process port bus is built from, and neither of them
needs a request pipeline.

> 🚧 Active development, API may change. Design:
> [`docs/design/streaming.md`](../../docs/design/streaming.md).

## Boundaries are `AsyncIterable`

Everything here speaks the language's own protocol. There is no `Stream`
type of our own, no `Observable`, no bridge to import. A subscription is
an `AsyncIterableIterator<T>`; a combinator is a function from
`AsyncIterable` to `AsyncIterable`.

## `Topic<T>`

```typescript
import { Topic } from '@nestling/streams';

class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  publish(event: ActivityEvent): void {
    this.#topic.push(event);          // never waits for consumers
  }

  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    return this.#topic.subscribe(signal);
  }
}
```

An event source is an **ordinary singleton provider** — there is no special
kind of endpoint or registration for it.

| Member | Meaning |
|---|---|
| `push(value)` | publishes; returns immediately at any number of subscribers, including zero |
| `subscribe(signal?)` | `AsyncIterableIterator<T>`; ends on `signal`, on `close()` and when the consumer stops iterating |
| `close()` | ends every subscription **normally** (not with an error) |
| `subscribers` | number of live subscriptions |
| `dropped` | events lost to buffer overflow — so the loss is never silent |

**The buffer is per subscriber** and bounded by `buffer` (default 1024).
When it overflows, `onSlowConsumer` decides:

- `drop-oldest` (default) — the oldest event of *that* subscriber is
  dropped, `dropped` grows, the subscription lives on;
- `disconnect` — *that* subscription ends; the others are untouched.

A hot source never blocks: `push` does not await anybody.

Ending a subscription frees its buffer and detaches it from the topic, so
subscribe/unsubscribe cycles do not accumulate resources — including the
case where the consumer never started iterating and simply called
`return()`.

## Item-chain combinators

The vocabulary is **closed and infrastructural**. `merge`, `switchMap`,
`combineLatest` and friends are not here and will not be: that is dataflow
programming, and its place is the handler, where the author is free to
reach for any library.

```typescript
import { filter, limit, gapTimeout, collect } from '@nestling/streams';

const guarded = gapTimeout(limit(filter(source, keep), 50_000), 30_000);
```

| Combinator | Behaviour |
|---|---|
| `tap(src, fn)` | observes each item; a throw from `fn` breaks the stream |
| `filter(src, pred)` | drops items the predicate rejects |
| `limit(src, max, onExceeded?)` | passes exactly `max` items, then fails |
| `gapTimeout(src, ms, onTimeout?)` | fails when the **source** is silent longer than `ms` |
| `throttle(src, perSecond)` | spreads items over time; buffers, never drops |
| `batch(src, size)` | groups into arrays; the remainder is flushed at the end |
| `through(src, fn)` | the single escape hatch: an arbitrary transform |

`limit` and `gapTimeout` take a failure factory because this package knows
nothing about statuses or `Fail`. On their own they throw `StreamLimitError`
/ `StreamGapTimeoutError`; the kernel passes its own factories, so inside a
pipeline the same combinators fail with `STREAM_LIMIT_EXCEEDED` (413) and
`STREAM_GAP_TIMEOUT` (504).

## Iterating under a signal

```typescript
import { untilAborted, collect } from '@nestling/streams';

for await (const item of untilAborted(source, signal)) { … }
```

`untilAborted` ends the iteration when the signal is raised **and closes the
source** (`return()`), so a generator's `try/finally` runs and subscriptions
are detached. `collect(src)` drains a stream into an array — handy in tests.
