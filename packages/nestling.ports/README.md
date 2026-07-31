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

## Dispatch policy — configuration, not code

| Policy | Behaviour |
|---|---|
| `local-first` (default) | co-located implementation is called through the bus `dispatch`: full pipeline, no payload copying |
| `always-remote` | the same call goes through the bus: async barrier, structural copy of payload and reply, reply validated against the contract's `output` |

```bash
NESTLING_PORTS_DISPATCH=always-remote node dist/main.js
```

`always-remote` is a rehearsal of the wire, not a running broker: whatever
does not survive `structuredClone` breaks here, in dev and in tests, instead
of in production after the split. The call site does not change.

The policy lives in the kernel config section `nestlingPorts`, read through
the ordinary configuration mechanism — so it is switchable by a bound source
and by `vars()` in the test root, not only by a process variable. There is
no `dispatch:` field in `assemble`: the root's field list is closed.

## What the assembly rejects

Phase ASSEMBLE fails fast on everything checkable without a network: a
`request`/`command` with no co-located implementation among the selected
features, a second owner (naming both modules), two `event` subscribers with
the same name, a missing or forbidden `subscriber`, and a contract whose io
forms are `stream`/`events` (the bus supports `value` only). An event with
zero subscribers is legal — broadcast into an empty room is a normal state.

## Phases

`dispatch` is born in WIRE, and the single late binding happens there:
invokers receive their executor and the bus subscribes to the subjects of
its routes. Calling a port in `@OnInit` is a clear error; in `@OnStart` it
works.

## Bus

`IMessageBus` is the least common denominator of broker verbs
(`request`/`publish`/`subscribe` with a delivery group); no broker specifics
leak past it. `InProcessBus` implements it *and* `ITransport` — one value
with two capabilities, which is the shape the NATS transport will take.
Broadcast is built on `Topic` from `@nestling/streams`, so publishing never
waits for a slow subscriber; `durable`, retries and persistence are out of
V1 — without an external broker they have nowhere to live.

The composition root says nothing about the bus: the ports kernel module
registers it, and it appears in the graph only when the application has at
least one contract implementation.

## Kernel / user space

Public: `makeContract`, `implement`, `Port`/`Emitter` types, `IMessageBus`,
`MessageBus$`, `InProcessBus`, `BusTransport$`, `busBindingOf`,
`portsKernel`, `bindPorts`, `collectImplementations`, `portsConfigKeys`.

Deliberately **not** exported: the contract registry, the `Port`/`Emitter`
families and their recipes, the executor holder and its token, and the
config section token. Those are the kernel side of the boundary, and the
boundary is held by ES module visibility.
