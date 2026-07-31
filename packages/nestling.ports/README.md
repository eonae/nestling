# @nestling/ports

Contracts, ports and the in-process message bus. A feature calls its
neighbour through a **contract**, not through the neighbour's service token —
which is what makes the call survive the day the two features move into
separate processes: it is already async, already `Fail`-able and already
outside the caller's transaction.

Dependencies: `@nestling/container`, `@nestling/pipeline`,
`@nestling/transport`, `@nestling/streams`, `@nestling/config`,
`@common/misc`. No schema validator is declared — a contract leaf is any
[Standard Schema v1](https://standardschema.dev) value.

> 🚧 Active development, API may change. Design:
> [`docs/design/contracts.md`](../../docs/design/contracts.md).
> Guide: [`docs/guides/ports.md`](../../docs/guides/ports.md).

## Declaring a contract

```typescript
import { makeContract } from '@nestling/ports';

export const ClaimQuota = makeContract({
  name: 'quotas.claim',                    // the address: bus subject, discovery key
  kind: 'request',                         // 'request' | 'command' | 'event'
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});
```

A contract is a value: it registers nothing in a module or an application.
It reaches the app in exactly two ways — someone implements it, someone
injects its invoker.

| Kind | Semantics | Owners | Invoker |
|---|---|---|---|
| `request` | request-reply, `Fail`-able | exactly one | `.port` → `call(input, meta?)` |
| `command` | fire-and-forget | exactly one | `.emitter` → `emit(payload, meta?)` |
| `event` | broadcast fact | 0..N subscribers | `.emitter` → `emit(payload, meta?)` |

`durable: true` is allowed on `command` and `event` and rejected on
`request` at declaration time (a request-reply has a live caller waiting,
so there is nothing to outlive). Durability is a property of the
**operation**, known to both sides — the publisher waits for the write to be
acknowledged, the subscriber reads durably, and they live in different
processes — so the contract is the only value available to both. How it is
served is the transport's business (`@nestling/transport.nats`); a bus
without that capability starts anyway and prints one line on go-live listing
the contracts it serves without persistence.

The version is part of the name (`users.create.v2`) — the name *is* the
address, so a separate version field would be a second address. A duplicate
name is an error at declaration time.

## Implementing — an ordinary declaration

```typescript
import { implement } from '@nestling/ports';

export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService],
  handle: (quotas) => async (payload) => {
    const claimed = quotas.claim();

    return claimed.ok
      ? new Ok({ remaining: claimed.remaining })
      : QuotaExceeded({ limit: quotas.limit });
  },
});

export const QuotasModule = makeAppModule({
  name: 'module:quotas',
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl],      // next to the HTTP handles
});
```

`implement` is a declaration constructor over the same kernel primitive as
`httpEndpoint`/`cliEndpoint`, so an implementation inherits the whole
machinery: discovery from the module tree, `dispatch`, pipeline and the
boundary guard, `policies`/`detached`, the `check()` report and
`app.call(Declaration, payload)` in tests. `input`/`output`/`errors` come
from the contract and cannot be redeclared (a compile error).

An `event` implementation must name itself with `subscriber:` — that is the
subscription address (`quotas.claim@billing` in-process, the queue-group
name once a broker is behind the bus). `request`/`command` have exactly one
owner, so `subscriber` is rejected there.

## Calling

```typescript
deps: [ClaimQuota.port, UserRegistered.emitter],
handle: (quotas, registered) => async (input) => {
  const claimed = await quotas.call({ email: input.email });
  if (claimed.isFail) {
    return claimed;                 // the caller must handle the failure
  }

  await registered.emit({ id: user.id, email: user.email });
  /* … */
}
```

`.port`/`.emitter` are ordinary tokens (token-family members), usable
anywhere a token is. Nothing is registered in the composition root: the
invoker node exists only for contracts someone actually injects.

- `call(input, meta?)` → `Promise<Ok<Output> | Fail<E ∪ UnknownError>>`;
- `emit(payload, meta?)` → `Promise<void>`, resolved on **delivery**, not on
  handling; a subscriber's failure never surfaces to the caller.

A declared failure is re-hydrated from its `code` into a real `Fail`, so
`QuotaExceeded.is(result)` holds on both binding paths. Anything undeclared
becomes `UnknownError`; the original goes to the diagnostic hook, never
across the port boundary.

## Operational profile — `meta`

`meta` is the **envelope of the call**, not ambient state: `signal`,
`deadline` and — for `command` only — `idempotencyKey`.

```typescript
import { deadlineIn } from '@nestling/ports';

await quotas.call({ email }, { deadline: deadlineIn(500) });
await ship.emit({ orderId }, { idempotencyKey: orderId });
```

`deadline` is an **absolute moment** (`Date`), never a duration: a duration
goes stale at every `await` between computing it and making the call, a
moment does not. `deadline: 500` does not compile — `500` reads equally well
as epoch milliseconds and as "in 500 ms", and `deadlineIn(ms)` is the sugar
that removes the ambiguity. There is **no default budget**: a call without
`deadline` runs unbounded, exactly as it did before.

The budget is checked at three points, and the failure is always the same
kernel code `DEADLINE_EXCEEDED` (status `TIMEOUT` → 504):

| Point | When | What happens |
|---|---|---|
| before the call | `call`/`emit` | remainder ≤ 0 → `DeadlineExceeded`, neither `dispatch` nor the bus is touched |
| before handling | message received | remainder ≤ 0 → `DeadlineExceeded`, `dispatch.call` is not invoked |
| in flight | while the call runs | the handler's `ctx.signal` fires and the call ends with `DeadlineExceeded` |

An abort by the **caller's** `meta.signal` stays `UnknownError`, as before:
the two are told apart by who owns the timer, not by `signal.reason`.

Over the wire the envelope carries a **relative** `timeoutMs`, recomputed
into an absolute moment by the receiver's own clock — the gRPC model, so
clock skew between processes never affects the budget, only transit does.
The behaviour is identical under `local-first` and `always-remote`.

`idempotencyKey` exists in the `meta` of `command` contracts only; on
`request` and `event` it is a compile error rather than a silently ignored
field. A command's `emit` always travels with a key — the caller's, or one
minted by the invoker. The kernel guarantees exactly two things: the key
arrives, and it is visible to the handler. **Deduplication is not in the
kernel** — that is a satellite over a store.

The profile reaches deep code through two channels:

| Channel | What it is | Availability |
|---|---|---|
| `ctx.raw.attributes` | the wire, next to `subject` | always, no composition needed |
| `Ctx(Deadline)` / `Ctx(IdempotencyKey)` | ambient projection | when `withDeadline()` / `withIdempotencyKey()` is composed into the pipeline |

The variables are exported **as values**, so
`everyEndpoint(…).hasVar(IdempotencyKey)` makes their presence an
assembly-time invariant. A nested call does **not** inherit the budget — a
handler that wants to pass the remainder on does it explicitly, exactly as
it must with `signal`:

```typescript
deps: [Ctx(Deadline), ChargeCard.port],
handle: (deadline, charge) => async (input) =>
  charge.call(input, { deadline: deadline.peek() }),
```

## Dispatch policy — configuration, not code

| Policy | Behaviour |
|---|---|
| `local-first` (default) | co-located implementation is called through the bus `dispatch`: full pipeline, no payload copying |
| `always-remote` | the same call goes through the bus: async barrier, structural copy of payload and reply, reply validated against the contract's `output` |

```bash
NESTLING_PORTS_DISPATCH=always-remote node dist/main.js
```

Without a broker, `always-remote` is a rehearsal of the wire: whatever does
not survive `structuredClone` breaks here, in dev and in tests, instead of in
production after the split. With a broker registered it becomes what it
promises — everything is a message over a real wire. The call site does not
change either way.

The policy lives in the kernel config section `nestlingPorts`, read through
the ordinary configuration mechanism — so it is switchable by a bound source
and by `vars()` in the test root, not only by a process variable. There is
no `dispatch:` field in `assemble`: the root's field list is closed.

## What the assembly rejects

Phase ASSEMBLE fails fast on everything checkable without a network: a
`request`/`command` with no co-located implementation among the selected
features **and** a bus that does not deliver outside the process, a second
owner (naming both modules), two `event` subscribers with the same name, a
missing or forbidden `subscriber`, and a contract whose io forms are
`stream`/`events` (the bus supports `value` only). An event with zero
subscribers is legal — broadcast into an empty room is a normal state.

Binding an invoker has three inputs: topology, **the nature of the bus** and
the dispatch policy. A remote bus turns "no owner selected here" into "the
owner lives elsewhere": `request`/`command` binds remote instead of failing,
and `event` always goes through the bus — the set of subscribers is open,
and a local dispatch would silently lose the ones in other processes.

## Phases

`dispatch` is born in WIRE, and the single late binding happens there:
invokers receive their executor and the bus subscribes to the subjects of
its routes. Calling a port in `@OnInit` is a clear error; in `@OnStart` it
works.

## Bus

`IMessageBus` is the least common denominator of broker verbs
(`request`/`publish`/`subscribe` with a delivery group); no broker specifics
leak past it. `InProcessBus` implements it *and* `ITransport` — one value
with two capabilities, the same shape `NatsBus` takes.

The interface declares two capabilities **as values**: `remote` (does it
deliver outside the process — an input of invoker binding) and `durable`
(can it deliver durably). `InProcessBus` declares both false: broadcast is
built on `Topic` from `@nestling/streams`, so publishing never waits for a
slow subscriber, but retries and persistence have nowhere to live without an
external broker.

The composition root need say nothing about the bus: the ports kernel module
registers `InProcessBus` when the application has at least one contract
implementation. A root **may** supply the bus itself — that is how a broker
is connected (`nats()` in `transports:`, see
[`@nestling/transport.nats`](../nestling.transport.nats/README.md)) — and
then the kernel module registers nothing: an application has exactly one
bus, and both tokens resolve to the very same instance.

## Versioning: the name carries it, the report highlights it

A contract has no version field. The version lives **in the name**
(`user.create.v2`), because the name is already the address; `makeContract`
neither requires nor parses the `.vN` suffix, so an unversioned name is
perfectly legal.

What remembers yesterday's shape is a **snapshot** — a plain value you store
wherever you like:

```typescript
const descriptor = describeContract(ClaimQuota, { converters: [zodConverter()] });
// { name, kind, input: { kind, leaf }, output: { … }, errors: [{ code, status }] }

const snapshot = snapshotContracts(await checkTopologies(spec, ['all', 'users'], {
  converters: [zodConverter()],
}));

const report = diffContracts(readBaseline(), snapshot);
console.log(formatCompatibility(report));
```

- **`describeContract`** turns a contract (or its `implement` declaration)
  into a JSON value. Leaf schemas go through a vendor converter
  (`SchemaDocConverter`, defined in `@nestling/pipeline` so that
  `@nestling/openapi` can share it); without one, a leaf is marked *opaque* —
  and "there is no leaf" and "there is a leaf we could not convert" are
  distinct markers, never conflated.
- **`snapshotContracts`** merges the reports of a `select`-topology matrix by
  **union**, so a contract missing from one topology is a deselected feature,
  not a deleted contract; each descriptor names the topologies that published
  it. `serializeSnapshot` is byte-deterministic: contracts by name, failures
  by code, JSON Schema keys sorted.
- **`diffContracts`** assigns every discrepancy exactly one verdict from a
  closed set — `breaking` | `additive` | `unknown`. Direction comes from the
  **slot**: `input` flows into the implementation (a new required property, a
  removed property, a narrowing — `breaking`), `output` flows out of it (a
  removed property, `required` → `optional` — `breaking`). Anything the
  published rules do not cover — unfamiliar JSON Schema keywords,
  `oneOf`/`allOf`/`$ref`, a changed vendor, an opaque leaf — is `unknown`
  with a JSON path, never a silent "compatible".
- **The report is a value**; `formatCompatibility` prints it for a human, and
  a contract with at least one `breaking` carries a **suggested** name
  (`quotas.claim` → `quotas.claim.v2`). That suggestion is the only place
  where the `.vN` suffix is recognised, and nothing is renamed.

**It cannot fail your build.** `diffContracts` is a pure function of two
values: it takes no part in assembly, is never called from `run()`/`check()`
and never throws on the result of a comparison, however many `breaking` it
found. There is no `failOnBreaking` flag — turning the report into a failing
test is `expect(report.breaking).toEqual([])` in *your* test. The one thing
it does throw on is an unreadable baseline (an unknown `snapshotVersion`):
that is the checker author's mistake, not a breaking change.

## Kernel / user space

Public: `makeContract`, `implement`, `Port`/`Emitter` types, `IMessageBus`,
`MessageBus$`, `InProcessBus`, `BusTransport$`, `busBindingOf`,
`portsKernel`, `bindPorts`, `collectImplementations`, `portsConfigKeys`,
the operational profile (`deadlineIn`, `Deadline`, `IdempotencyKey`,
`withDeadline`, `withIdempotencyKey` and the re-exported `DeadlineExceeded`,
defined in `@nestling/pipeline` where the closed set of kernel codes lives),
and the compatibility surface: `describeContract`, `snapshotContracts`,
`serializeSnapshot`, `diffContracts`, `formatCompatibility`, `suggestBump`,
`canonicalizeJson` and their types.

Deliberately **not** exported: the contract registry, the `Port`/`Emitter`
families and their recipes, the executor holder and its token, and the
config section token. Those are the kernel side of the boundary, and the
boundary is held by ES module visibility.
