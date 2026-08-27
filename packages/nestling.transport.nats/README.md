# @nestling/transport.nats

NATS as the application's bus — inbound and outbound. `NatsBus` is one
value with two capabilities: `IMessageBus` facing outward
(`request`/`publish`/`subscribe`) and `ITransport` facing inward
(`serve(dispatch, signal)`). There is no separate "messaging" entity next
to "transports": the bus **is** a transport.

## Registering it

`nats(options?)` is an ordinary transport provider registered under
`BusTransport$` — the same token the in-process bus uses. When the root
supplies it, the ports kernel module does not register `InProcessBus`, and
`MessageBus$` resolves to the very same instance: an application has
exactly one bus.

```ts
await assemble({
  features: [OrdersFeature, BillingFeature],
  select: load(RootConfig).features,
  transports: [http(), nats()],
}).run();
```

No `implement(...)` declaration, no contract and no call-site changes when
`nats()` is added or removed. That is level L4 from
`docs/design/composition.md`.

## What changes for ports

With a bus that delivers outside the process, binding of invokers gains a
third input — the nature of the bus:

| Kind | Co-located | Bus is remote | Binding |
|---|---|---|---|
| `request` / `command` | yes | any | policy (`local-first` / `always-remote`) |
| `request` / `command` | no | yes | **remote** |
| `request` / `command` | no | no | fail-fast on ASSEMBLE |
| `event` | any | no | local dispatch to each co-located subscriber |
| `event` | any | yes | **always remote** |

`event` is always remote when a broker is present because the set of
subscribers is open: some of them live in other processes, and a local
dispatch would silently lose them. A co-located subscriber still gets
exactly one copy — the one that comes back through its own subscription.

## Addressing

Subject is the contract name, prefixed by `NATS_SUBJECT_PREFIX` when set.
The delivery group comes from the contract kind — the same map the
in-process bus already computes:

| Kind | Queue group | Effect |
|---|---|---|
| `request` | `owner:<subject>` | replicas of the owner share req-reply |
| `command` | `owner:<subject>` | the command reaches exactly one replica |
| `event` | `<subscriber>` | every subscriber gets a copy; its replicas share it |

Adding a replica requires no configuration change.

## Phases

| Phase | What happens |
|---|---|
| INIT | `connect()` — a connection is a resource, so it is captured with the others. Calling a port from `@OnStart` reaches the broker. |
| WIRE | `attach(dispatch)` — routes are remembered and io forms are checked. No subscriptions yet. |
| START (go-live) | `serve(dispatch, signal)` — subscriptions. An incoming message cannot catch an unfinished `@OnStart`. |
| SHUTDOWN | `close()` — drain. Unacked durable messages return to the stream and go to another replica. |

## The wire

The body is encoded by the codec (JSON by default, replaceable with the
`codec` factory option). The envelope travels as headers:

| Header | Meaning |
|---|---|
| `Nl-Timeout-Ms` | relative remaining budget; becomes an absolute deadline on the receiving clock |
| `Nl-Idempotency-Key` | idempotency key of a command |
| `Nl-Ctx` | propagated ambient variables, JSON object |
| `Nl-Subject` | diagnostics only |

`Nl-Ctx` is a single header rather than one per variable on purpose: NATS
canonicalises header names by MIME rules, so `Nl-Ctx-tenantId` would arrive
as `Nl-Ctx-Tenantid`. A variable key is the name of a field in the
accumulated pipeline `input`, and it has to survive verbatim.

**The JSON codec is stricter than `structuredClone`**, which the
`always-remote` policy uses to rehearse the wire in-process: `Date` arrives
as a string, `Map`, `Set` and `undefined` are lost. Nothing is lost
silently — input is validated against the contract schema **on receipt**,
so a field that collapsed to a string produces a validation failure naming
the field.

## Request ceiling

A broker request is never unbounded. A call without `meta.deadline` goes
out with the `NATS_REQUEST_TIMEOUT` ceiling (30s by default); a call with a
budget is limited by `min(remaining, ceiling)`. This is not a default
*budget*: a budget is a property of the call and is inherited downward, a
ceiling is a property of the wire, like a socket timeout on an HTTP server.
The difference is visible in the failure text.

## Durable delivery

`durable: true` is declared on the **contract** (`command` and `event` only;
on a `request` it is rejected at declaration time). Both sides must know:
the publisher waits for the write to be acknowledged, the subscriber reads
with a durable consumer, and they live in different processes — the only
value available to both is the contract itself.

Under the hood: a stream named `nestling_<subject>` covering exactly that
subject, a durable consumer named after the delivery group, `ack` once
processing **reached a decision** (success and a declared `Fail` alike),
`nak` when it did not (an unhandled exception, or the process stopping with
the message in flight), `term` plus a diagnostic report when attempts run
out. An existing stream covering the subject is accepted **as is** —
retention, storage and limits stay an operational concern; a stream with
the same name and a conflicting subject set is a fail-fast.

`InProcessBus` cannot do durable delivery and says so: an application with
durable contracts on it starts and prints one line on go-live listing the
contracts served without persistence.

## Testing without a broker

The broker client is isolated behind a narrow connector (`connect` factory
option). An in-memory double is exported under the `./testing` conditional
export:

```ts
import { NatsDouble, natsDouble } from '@nestling/transport.nats/testing';

const broker = new NatsDouble();
const app = assemble({ transports: [nats({ connect: natsDouble(broker) })] });
```

One double handed to two roots models a **cluster**: two processes on one
broker. The double covers subjects, wildcard matching, queue groups,
req-reply with `no responders`, headers and a minimal JetStream (stream,
durable consumer, ack/nak, redelivery).

**The double checks our code, not compatibility with the broker.** For
compatibility there is the integration run, and it must be executed before
publishing the package:

```bash
docker run --rm -p 4222:4222 nats:2 -js
NATS_TEST_SERVERS=nats://127.0.0.1:4222 yarn workspace @nestling/transport.nats test
```

Without `NATS_TEST_SERVERS` the integration suite is skipped, so
`yarn verify` stays green offline.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `NATS_SERVERS` | `nats://127.0.0.1:4222` | cluster addresses, comma separated |
| `NATS_REQUEST_TIMEOUT` | `30000` | req-reply ceiling |
| `NATS_SUBJECT_PREFIX` | empty | separating environments on a shared cluster |

Only the `.keys` handle leaves the package (`natsConfigKeys`); the section
token stays private. Everything that is not about the environment —
`connect`, `codec`, `maxDeliver`, diagnostic hooks — is a factory argument.

## Not here on purpose

Outbox and saga, idempotency deduplication, the `balanced` dispatch policy,
streaming over the bus (`capabilities` are `value`-only, same as the
in-process bus), a `natsEndpoint` declaration form (plumbing is expressed by
injecting `MessageBus$` and calling `subscribe('orders.>', …)` in
`@OnStart`), JetStream beyond durable delivery (KV, object store, ordered
consumers, dead-letter queues), and more than one bus per application.
