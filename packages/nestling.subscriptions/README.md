# @nestling/subscriptions

> 🚧 Active development, API may change. Design:
> [`docs/design/streaming.md`](../../docs/design/streaming.md) (§4.1).
> Guide: [`docs/guides/subscriptions.md`](../../docs/guides/subscriptions.md).
> The measurement this package exists for:
> [`ideas.md [2026-08-01]`](../../docs/decisions/ideas.md).

A registry of **active subscriptions**: list them, kill one, watch the feed
of changes. Written entirely on top of public primitives — the kernel does
not know this package exists.

That is the point of it. `@nestling/subscriptions` is the litmus test for
one claim of the model: *a satellite is written without touching the
kernel*. `git diff` over `@nestling/{pipeline,app,container,ports,contracts,
streams,transport*,testing}` is empty for the whole change that introduced
this package, and its `dependencies` are:

| Dependency | What for |
|---|---|
| `@nestling/container` | `@Injectable`, `@OnDestroy`, `makeModule` — the layer units and the module |
| `@nestling/pipeline` | `makePipeline` for the `tracked` layer, `Outcome` and context types |
| `@nestling/contracts` | `makeContract` for the lifecycle facts, `describeForm`/`isStreamKind`, `jsonSchema` |
| `@nestling/streams` | `Topic` — the change feed |
| `@common/misc` | the Standard Schema types |

No external dependencies, no schema vendor, and **no `@nestling/app`**: had
the package needed the assembly machinery, «a satellite is written without
access to it» would have been false.

## Three moving parts

```typescript
import { subscriptions, SubscriptionRegistry, tracked } from '@nestling/subscriptions';

// 1. the module — created once in the composition root
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,                       // lifecycle facts as contracts, opt-in
  node: process.env.HOSTNAME,
});

// 2. the layer — composed onto a handle like any other cross-cutting behaviour
export const Feed = httpEndpoint({
  method: 'GET',
  path: '/api/feed',
  output: events(Event),
  pipeline: compose(basePipeline, tracked),
  deps: [EventHub],
  handle: (hub: EventHub) => async (_payload, meta) =>
    // the combined signal: disconnect + shutdown + administrative kill
    new Ok(hub.subscribe(meta.subscription.signal)),
});

// 3. the registry — an ordinary singleton, injected by an ordinary token
export const ListSubscriptions = httpEndpoint({
  method: 'GET',
  path: '/api/ops/subscriptions',
  output: z.array(SubscriptionSchema),
  pipeline: basePipeline,
  deps: [SubscriptionRegistry],
  handle: (registry: SubscriptionRegistry) => async () => new Ok(registry.list()),
});
```

## `SubscriptionRegistry`

| Member | Meaning |
|---|---|
| `list(filter?)` | snapshots of active subscriptions, rebuilt on every call |
| `get(id)` | one snapshot or `undefined` |
| `abort(id, reason?)` | arms the administrative controller; `true` if the record existed |
| `abortAll(filter?, reason?)` | the same for everything matching the filter; returns the count |
| `watch(signal?)` | `AsyncIterableIterator<SubscriptionEvent>` over the private `Topic` |
| `size` | number of active subscriptions in **this** process |

`SubscriptionInfo` is a frozen value (`id`, `transport`, `pattern`, `kind`,
`identity?`, `labels`, `startedAt` as epoch ms, `itemsOut`). It is assembled
at the moment of the call, reading `itemsOut` from `ctx.summary`: what
leaves the registry is a value, never an object the runtime mutates.
`list(filter)` matches `transport`/`pattern`/`identity` exactly and `labels`
by subset.

`abort()` **does not remove the record** — it only arms the signal. The
record is removed the ordinary way, by the pipeline's `.finally`, when the
stream actually ends. The registry reflects the fact instead of running
ahead of it.

## Why the signal is a second field

`meta.signal` stays the signal of the *request*: the `signal` key in `meta`
is reserved by the pipeline (capability `request-abort-signal`), and no
outside code may override it. So the layer adds a typed field of its own:

```typescript
meta.subscription = {
  id: string,
  signal: AbortSignal,   // AbortSignal.any([ctx.signal, admin controller])
}
```

One subscription to that signal covers all three reasons for cancellation:
client disconnect, graceful shutdown and administrative kill. A handler that
listens to `meta.signal` instead will survive `registry.abort(id)` — the
record leaves the registry, but the source keeps flowing until the client
disconnects. Types do not catch that (both fields exist); the guide shows
only the correct form.

## The close reason: the kernel's vocabulary plus one word

```typescript
type CloseReason = Outcome | 'killed';
// 'completed' | 'disconnected' | 'aborted' | 'failed' | 'killed'
```

The pipeline cannot express an administrative kill and should not:
`computeOutcome` looks at the *request* signal, and a source that ended
because of the registry's own controller honestly reports `completed`. The
kernel describes the outcome of a request, the registry describes the fate
of a subscription. Consequence worth knowing: an observer that reads only
`outcome` (a `.finally` audit unit, say) will not learn about the kill.

## Lifecycle facts (opt-in)

With `publish: true` the registry publishes two `event` contracts —
`subscriptions.opened` and `subscriptions.closed` — carrying the node name.
Watching the subscriptions of a **whole cluster** therefore needs no line of
kernel code: another feature does `implement(SubscriptionOpened, {
subscriber: 'ops', … })` and receives them.

Their schemas are hand-written (`vendor: 'nestling'`) and annotated with
`jsonSchema(...)`: Standard Schema is an interface, so the package does not
drag zod in and does not impose a vendor on the application, and the
annotation keeps the facts documentable and diffable anyway.

Publication never blocks a subscription: it is queued (facts keep their
order), a failing `emit` is swallowed and handed to the optional
`onPublishError(error, event)` hook. Publication is off by default because
on a remote bus every fact is a network round trip, and paying it on every
subscription must be a decision of the composition.

## Module options

| Option | Meaning |
|---|---|
| `identity` | extractor of the subscriber from the request context |
| `labels` | extractor of subscription labels |
| `feedBuffer` | per-observer buffer of the change feed (default 256, `drop-oldest`) |
| `publish` | publish lifecycle facts as contracts (default `false`) |
| `node` | node name carried by the facts |
| `onPublishError` | observer of publication failures |

Options are decisions of the **composition** only; nothing «from the
environment» lives here — bind `node` through config in the root if you want
it from the environment.

The module value is created once and imported by whoever needs it: a second
`subscriptions({ … })` call produces a different value under the same name
and fails the assembly (module identity is the value).

## What this package does not do

- **Cluster-wide kill.** The registry is node-local: `abort()` acts on its
  own process. The V1 bus offers neither scatter-gather nor a broadcast
  subscription without a queue group, so an admin plane over a cluster is
  not simulated with a single-owner `request` contract. Observation *is*
  cluster-wide (the facts). See
  [`deferred.md`](../../docs/decisions/deferred.md).
- **History.** Only active subscriptions live here; «who subscribed
  yesterday» is a job for a facts consumer that owns storage.
- **Metrics and dashboards.** `itemsOut` is in the snapshot because
  `ctx.summary` already had it; there is no exporter, no aggregate, no UI.
- **Quotas** («no more than N per user») — an application-level pre-unit over
  `registry.list(filter)`; the policy belongs to the application, and the
  guide shows it.
- **Automatic placement of the layer.** `tracked` is composed explicitly;
  «it is everywhere it should be» is guaranteed by an assembly policy
  (`everyEndpoint(…).hasLayer(tracked)`), not by an ambient mechanism.

## Known limits

- A streaming response that the transport closes **before the first**
  `next()` does not run `.finally` (the finish wrapper is an async generator,
  and `return()` on an unstarted one does not execute its body). Such a
  record stays in the registry for the lifetime of the process. This is a
  kernel-side defect recorded as finding №4 of the measurement and pinned by
  `src/core-limits.spec.ts`.
- `@OnDestroy` closes the feed, so on SHUTDOWN observers finish **normally**
  but do not see the closing events of subscriptions that drain after them.
  The alternative — keeping the feed open — would mean an observer (itself a
  subscription) prevents the process from stopping.

## Dev dependencies

Tests use `@nestling/testing` (and through it `@nestling/app`),
`@nestling/ports` and `@nestling/transport`. They are `devDependencies` on
purpose: the production graph of the package is the five packages in the
table above.
