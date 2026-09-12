# Operations, callers and clients

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-08] Порты: межфичевое общение через операции`,
> `[2026-07-13] Типизированные клиенты из операций`,
> `[2026-07-13] Порты: deadline, идемпотентность, версионирование операций`,
> `[2026-07-13] Операция первичен`; the refinements of the
> implementation are the entry of 2026-07-31 (ports, versioning, NATS)
> and `[2026-08-01] Клиенты из операций: реализация`.
> `[2026-09-07] Транзакционный outbox: точка врезки, предпосылка транзакции и результат замера границы`,
> `[2026-09-12] Транзакционный приём: inbox как вторая половина гарантии outbox'а`; a deferred saga —
> [deferred](../../decisions/deferred.md).
> `[2026-09-03] Код отказа: категория и уточнение; makeFail`,
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`,
> `[2026-09-03] Декларация приложения: makeApp, assemble(select), AssembledApp`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

An operation is the unit of communication between features: a name, a
kind, the input and output schemas, the list of failures. The same value
is used by three sides: the implementation (`implement`), the caller
(`.caller` or `.emitter`) and the external client (`makeClient`). This
document describes the operation itself (§1), the callers and the call
binding (§2), the intercom and the dispatch policy (§3), the call
profile (§4) and the external client (§5).

## 1. The operation

There are three constructors, one per kind. The kind follows from the
point of declaration, not from a field: the rules of the kinds diverge,
and the type checks the divergence.

```typescript
export const ChargeCard = makeRequest({
  name: 'billing.charge',            // the address: the intercom subject, the discovery key
  http: 'POST /billing/charges',     // the HTTP address (optional); the bind map
  input:  z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  errors: [CardDeclined],            // the typed list of failures (errors.md)
  doc: { summary: 'Charge a card', tags: ['billing'] },  // schemas.md §2.2
});

export const SendReceipt = makeCommand({
  name: 'billing.send-receipt',
  input: z.object({ orderId: z.string() }),
  durable: true,                     // the instruction survives unavailability
});

export const OrderPlaced = makeEvent({
  name: 'orders.placed',
  input: z.object({ orderId: z.string() }),
});
```

| Constructor | Caller | `output` / `errors` | `durable` | `subscriber` on an implementation |
|---|---|---|---|---|
| `makeRequest` | `.caller` | present | inexpressible | forbidden |
| `makeCommand` | `.emitter` | present | present | forbidden |
| `makeEvent` | `.emitter` | inexpressible | present | required |

The rules read as types, not as checks when the value is created:
`makeEvent({ output })` does not compile, because an event has no
response; `makeRequest({ durable })` does not compile, because the
caller waits for a response, and there is nothing to survive.

### 1.1. Addresses

`name` is the address of the operation on the bus (a NATS subject) and
the discovery key. `http:` is the address of the same operation for
HTTP; the field is optional. An operation is neutral to direction: one
value serves both the implementation and the call. It is not neutral to
the transport: the addresses of every transport are declared on it. The
bind map of the HTTP address is computed at declaration time, so an
error in it is caught at the owner of the operation, and the transport,
OpenAPI and the client read the ready map from one import.

### 1.2. The `doc:` section

The documentation section belongs to the operation on a par with
`input`, `output` and `errors`: the documentation of an operation is
part of its interface. An external consumer gets it through the same
import as the schemas. An operation implementation cannot redeclare
`doc:`, neither in the types nor at runtime, so two implementations of
the same operation describe it the same way. The set of fields and the
check rules are in [schemas.md §2.2](./schemas.md).

### 1.3. Three kinds

| Kind | Semantics | Owners |
|---|---|---|
| `request` | a request and a response, `Ok` or `Fail` | exactly one |
| `command` | no response; handled by one receiver (a queue group) | exactly one |
| `event` | a fact; received by every subscriber | 0..N subscribers |

The distinction between `command` and `event` serves horizontal
scaling: the replicas of the owner of a command form one group and
share the load, while an event reaches every subscriber. For
communication between features, `event` fits by default: `request`
makes the caller wait for a neighbor, `event` does not.

### 1.4. Durability

The `durable: true` field is allowed on `command` and `event`; on
`request`, `makeRequest` / `makeCommand` / `makeEvent` rejects it at
declaration time. The mark is declared on the operation, because both
sides must know it: the publisher waits for the write to be
acknowledged, the subscriber reads durably, and they live in different
processes. There is no other place to declare it, neither in
`implement` nor in the transport configuration. The transport decides
how to serve the mark (§3); the names of broker mechanisms (JetStream)
do not appear in the operation, the binding or the envelope.

### 1.5. Packages

`makeRequest` / `makeCommand` / `makeEvent`, `makeFail`, `Ok`/`Fail`, the
list of statuses, the io shapes and the bind map live in
`@nestlingjs/operations`. The package has no runtime dependencies
(transitively, only the types of Standard Schema), so an operation can
be imported into a frontend and into scripts. A test that walks the
import graph of the built package checks this invariant. The package
gets the `InjectionToken` primitive from the
`@nestlingjs/container/tokens` subpath — leaf modules with no runtime
imports — thanks to which `.caller` and `.emitter` are real members of
DI token families.

The runtime (the callers, the bus, the binding) lives in
`@nestlingjs/app`. It re-exports the caller types (`Port`, `Emitter`,
`PortMeta`), but not `makeRequest` / `makeCommand` / `makeEvent`: the
declaration of an operation is imported only from
`@nestlingjs/operations`.

There must be exactly one copy of the package in an application. The
package keeps module-level state: the DI token family members of the
callers and the registry of operation names. Two copies give two
registries and two DI token identities, and an operation declared
through the first copy is not recognized by the second one. The
assembly reports this with a duplicate-name error. In a monorepo with
the workspace protocol, there is one copy by construction; outside it,
the consumer pins the version of the package.

### 1.6. Version

The version is part of the name: `user.create.v2`. There is no separate
version field. `makeRequest` / `makeCommand` / `makeEvent` neither
requires nor parses the `.vN` suffix; an operation with no suffix is
allowed.

### 1.7. Schema diff

Comparing the schemas with a snapshot of published operations shows
incompatible changes, but blocks neither the build nor CI. How it works:

- `describeOperation(operation, { converters? })` returns an
  `OperationDescriptor`, a JSON value: the name, the kind, a tree of io
  shapes, the failure codes and the statuses. A vendor converter
  translates the leaf schemas ([schemas.md](./schemas.md) §2); with no
  converter, a leaf is marked opaque. "There is no schema" and "there is
  a schema, but it is not converted" are different states.
- `.check()` puts the descriptors of the published operations into the
  `operations` field of the report. The source is discovery
  (declarations with a bus binding), not a private registry of
  `makeRequest` / `makeCommand` / `makeEvent`. `snapshotOperations(reports)`
  reduces the matrix of `select` topologies
  ([testing.md](./testing.md)) into an `OperationSnapshot` by union: an
  operation missing from one topology out of three is an unselected
  feature, not a deleted operation. Serialization is deterministic: the
  same graph gives byte-for-byte the same file.
- `diffOperations(baseline, current)` gives every discrepancy exactly
  one verdict: `breaking`, `additive` or `unknown`. The slot decides the
  direction. `input` arrives at the implementation, so narrowing what
  is accepted is `breaking`; `output` leaves it, so weakening the
  guarantee is `breaking`. The rule is the same for all three kinds.
  Everything the rules do not cover (unfamiliar JSON Schema keywords, a
  vendor change, an opaque leaf) gets `unknown`, not "compatible".
- A report is a value; `formatCompatibility` prints it for a person. An
  operation with a `breaking` verdict gets a hint of a new name: for
  `billing.charge` this is `billing.charge.v2`. The hint is the only
  place where the `.vN` suffix is recognized; no renaming happens.
- `diffOperations` does not take part in the build, is not called from
  `run()` or `check()`, and does not throw based on the comparison
  result; there is no "fail on breaking" flag. There is one exception:
  an unreadable baseline (a foreign `snapshotVersion`) is an error of
  the checker's author, and it throws.

### 1.8. Three consumers of a declaration

An operation is a value, and anyone can read it. Today three consumers
do, and all three surfaces are derived from one declaration:

- [`@nestlingjs/openapi`](../../../packages/nestling.openapi/) builds an
  OpenAPI 3.1 document from the declarations;
- [`@nestlingjs/client`](../../../packages/nestling.client/) builds a typed
  HTTP client from the same declarations;
- [`@nestlingjs/mcp`](../../../packages/nestling.mcp/) builds the tool
  definitions for an agent from them.

The match with a tool definition is complete: `makeRequest` requires a
`name` and takes `input`, `output`, `errors` and the `doc` section, while
the protocol requires `name` and `inputSchema` and takes `description`,
`outputSchema` and `annotations`. Only the schemas have to be translated,
from Standard Schema into JSON Schema, and that is done by the same helper
the OpenAPI generator uses ([transports.md](./transports.md), §8).

No field that only makes sense for an agent appears in the `doc` section:
that section does not depend on the documentation format. The name, the
description and the hints for the agent are declared by the dictionary of
the tool declaration.

## 2. Ports

### 2.1. Implementation

`implement(Operation, { pipeline?, handler, subscriber?, detached? })`
([endpoints.md](./endpoints.md)) creates an endpoint declaration on top
of the same kernel primitive as `httpEndpoint.<method>` and
`cliEndpoint`. The implementation is placed into the `endpoints:` of a
module and gets everything any endpoint has: discovery, `dispatch`, a
pipeline, the check of failures on the way out, `policies` and
`detached`, the `check()` report and calling by value in tests. `input`,
`output` and `errors` come from the operation; redeclaring them in the
implementation is a compilation error.

An operation with an `http:` section is implemented by the second
transport constructor: `httpEndpoint.implement(Operation, { pipeline?,
handler, detached?, on? })`. The operation comes first, in the place
where the constructor by method has the path. The fields `bind`,
`rawBody`, `sse`, `input`, `output`, `errors` and `doc` do not exist at
all in the implementation dictionary: the address and the schemas come
from the operation, the bind map is the same value, computed once. The
constructor rejects an operation with no `http:` when the declaration
is created; the error text suggests declaring the section or
implementing the operation on the intercom through `implement`.

### 2.2. Addresses of implementations

The pattern of an endpoint in a process and the subject on the bus
differ. The pattern is `<name>` for `request`/`command` and
`<name>@<subscriber>` for `event`; the subject is always `<name>`. The
`subscriber:` field is required for `event` (0..N subscribers) and
forbidden for `request`/`command` (exactly one owner). The author sets
the subscriber name explicitly: with a broker it becomes the name of
the queue group and the durable subscription.

### 2.3. Calling

The consumer injects `Operation.caller` or `Operation.emitter`:

```typescript
handler: {
  deps: [ChargeCard.caller],
  handle: (billing) => async (input, meta) => {
    const charge = await billing.call({ orderId: input.id, amount: input.total }, meta);
    if (charge.isFail) return charge;          // a failure is data, not an exception
    /* ... */
  },
}
```

A port is bound to a local client (an implementation in the same
process) or a remote client (through the bus) at the composition root;
the request calls the already-picked constant. Binding has three
inputs: the topology (which features are selected into this process),
the nature of the bus (does it deliver outside the process), and the
dispatch policy (§3). A caller is a member of a DI token family, so a
graph node appears only for operations that someone injects.

The nature of the bus affects binding this way. On a remote bus, a
`request`/`command` with no implementation in this process binds
remote, and the assembly does not fail. There is no check of the
cluster composition: an unreachable owner at runtime is an ordinary
delivery failure. An `event` on a remote bus always goes through the
bus: the set of subscribers is open, and part of it lives in other
processes. A subscriber in the same process gets exactly one copy,
through its own subscription at the broker.

The type of a call is the same in one process and in a split
deployment: always async, always `Ok | Fail`. A remote failure is
restored into a real `Fail` by `code` ([errors.md](./errors.md)). The
set of responses is closed: the declared failures plus the kernel
categories (`internal_error`, `bad_request`), the same as for an
endpoint.

`emit` returns a `Promise<void>` on delivery, not on handling. A
subscriber's failure reaches a diagnostic hook, not the caller.

Callers get their executor on the WIRE phase, where `dispatch` is
created. There the bus also subscribes to the subjects of its own
routes, so `@OnStart` can already call a port. A call before WIRE ends
with an error, not a wait.

The port node counts two metrics: `nestling.port.calls` and
`nestling.port.duration` with the attributes `operation`, `kind`,
`binding` and `outcome` ([container.md](./container.md), "The kernel
metrics"). The record is written at the caller, because it alone sees
both binding paths, and it covers both call shapes — `call` and `emit`.
The set of metrics is the same for `local-first` and `always-remote`;
the `binding` attribute tells them apart. A port call with a co-located
implementation goes through `dispatch` and therefore produces both
groups of records: its own and the record of the implementation's
endpoint.

### 2.4. Rules

A port is never transactional, even in one process: the call runs in
its own request scope, and the asynchronous context of the caller does
not reach inside. A local port may return `Fail`. The input is
validated on both paths. Consistency between features is provided by
events plus an outbox (§2.6) or a saga
([deferred](../../decisions/deferred.md)), not by a shared transaction.

### 2.5. Assembly errors

The assembly fails when: a `request`/`command` has no implementation in
the process and no remote binding; an operation has two owners; an
event has two subscribers with the same name; a port operation declares
a `stream` or `events` shape. An event with no subscribers is allowed.

### 2.6. Transactional emit

`emit` delivers a message right away, while the business change is
committed separately. Between the commit and the send there is a
window where a process crash loses the event. A transactional emit
closes it: the event is written to the database in the same transaction
as the business change, and a background task publishes it after the
commit.

The kernel does not do this: it would have to pull in storage. The
mechanism lives in the satellite
[`@nestlingjs/outbox`](../../../packages/nestling.outbox/) and is built
entirely on public primitives: DI token families, context variables,
the `@Resource` role, the `@OnStart` hook and the `IMessageBus`
interface.

A transactional emitter is given by a **second DI token**, next to
`Operation.emitter`, not in place of it:

```typescript
@Handler([outboxed(UserCreated), UsersRepository$])
export class CreateUserHandler {
  constructor(
    private readonly userCreated: OutboxEmitter<typeof UserCreated>,
    private readonly users: UsersRepository,
  ) {}
}
```

The value is `OutboxEmitter<C>`: a kernel emitter whose `meta`
dictionary is extended with a record section
(`emit(user, { partitionKey: user.id })`). It is assignable to
`Emitter<C>`, so a handler that does not need the section declares the
dependency with the same type, and the body of the handler does not
change; only the line in the dependency list changes. The section names
the place of the call: it knows what orders the record. Both emitters
coexist: a non-transactional send from `@OnStart` or a background task
is written with the ordinary `Operation.emitter`.

The transaction is a precondition of the application, not a concern of
the package. The application declares it as a context variable of its
own type, opens and closes a pipeline layer, and the package only reads
it through a reader and passes it to the storage adapter opaquely. The
reason is in the driver: the adapter and the transaction must be on the
same connection, and the package that carries the transaction layer
must carry the driver.

The absence of a transaction is caught on the ASSEMBLE phase: the
plugin gives out a policy as a value, the predicate is `hasVar` over
the passed variable ([pipeline.md](./pipeline.md)). `emit` outside a
transaction ends with an error; there is no mode of "send directly if
there is no transaction".

Publication carries an idempotency key equal to the identifier of the
record, so delivery ends up at-least-once. The decision logic and the
result of measuring the boundary are in
[ideas.md](../../decisions/ideas.md) `[2026-09-07]`.

A retry on receipt is removed by a transactional receipt, the satellite
[`@nestlingjs/inbox`](../../../packages/nestling.inbox/). Its layer
marks a message as handled in storage, by the transaction of the
caller, and a repeated message finishes with an early success, without
reaching the handler ([pipeline.md §3](./pipeline.md)).

The mark is stored by the pair "the pattern of the endpoint and the
idempotency key". The pattern is always available and already contains
the subscriber name as a suffix after `@`, so the layer does not need a
second place for the name. One event reaches several subscribers with
one key, and each one deduplicates it separately.

The layer takes the key from the envelope of the message
(`ctx.raw.attributes`), not from the `IdempotencyKey` variable that the
kernel's standard writer filled in: `withIdempotencyKey()` mints a
missing key itself, and a minted key would differ between two
deliveries of the same message and would always look new. A message
with no key in the envelope ends with an error.

The precondition is the same as for the outbox: the transaction
variable of the application and the policy on the ASSEMBLE phase. The
predicate of the policy here is `hasLayer`: the layer belongs to the
package, and the endpoint is checked for descent from this value. For
an effect outside the transaction, the layer only narrows the retry
window (§4.2). The decision logic is in
[ideas.md](../../decisions/ideas.md) `[2026-09-12]`.

The ready-made storage adapter for PostgreSQL and the transaction layer
it runs on are described in [persistence.md](./persistence.md).

## 3. The bus and the dispatch policy

The kernel depends only on the `IMessageBus` interface, with the
`request`, `publish` and `subscribe` operations — the minimal set any
broker has. Implementations: `InProcessBus` with no dependencies, and
`@nestlingjs/transport.nats` (a queue group for replicas, JetStream for
`durable`). The specifics of NATS do not reach the API of operations.

`InProcessBus` is one value with two interfaces: `IMessageBus` (the
outgoing side) and `ITransport` (the incoming one,
`serve(dispatch, signal)`). Broadcast is built on `Topic`
([streaming.md](./streaming.md)), so publication does not wait for a
slow subscriber. The io shapes are `value` only. The in-process bus is
not mentioned in the root: a kernel module of the ports registers it,
and it starts accepting calls only once at least one discovered
implementation needs it.

The root can supply its own bus: `nats()` is an ordinary transport
provider under the same DI token. When it is present in `transports:`,
the kernel module of the ports does not register its own
implementation, and both DI tokens (`MessageBus$` and the DI token of
the bus transport) give one instance. There is exactly one bus in an
application; a broker is not added to the in-process bus, it replaces
it.

The bus declares two capabilities as values: `remote` (does it deliver
outside the process, the input of binding, §2) and `durable` (can it
deliver durably, §1). Both are false for `InProcessBus`. An application
with `durable` operations on such a bus starts, but prints a line at
start with the list of operations served without durability, the same
way as the list of `detached` endpoints.

The dispatch policy is chosen at assembly:

- `local-first` — an implementation from the same process is called
  directly, the rest go through the bus;
- `always-remote` — every call travels as a message. On the in-process
  bus this means an asynchronous barrier, a structural copy of the
  payload and the response, and a check of the response against the
  `output` schema; on a broker, a send over the network.

The policy is the `dispatch` field of the `nestlingPorts` kernel
configuration section (`NESTLING_PORTS_DISPATCH`, `local-first` by
default). It is read by the ordinary configuration mechanism; there is
no `dispatch:` field in `makeApp`. Changing the policy is changing the
configuration; the calling code does not change.

## 4. The call profile

A call in one process and a call over the network differ in their
operational profile: the time budget, idempotency, context propagation.
The profile is built into the API of the operation.

### 4.1. Time budget

`meta.deadline`, next to `meta.signal`, is an absolute moment of type
`Date`; `deadlineIn(ms)` exists for convenience. A number is not
accepted: `500` reads equally well as an epoch and as "in 500 ms". The
model is the same as gRPC: inside a process a moment travels, over the
network a relative timeout travels (a clock mismatch does not matter),
and on receipt it becomes a moment again, by the receiver's clock.
There is no default budget: a call with no `deadline` has no time
limit.

There are three checkpoints: a check before the call (`dispatch` and
the bus are untouched), a check before handling on receipt, and
cancellation during handling. The signal of the handler is a
composition of the budget and `meta.signal`, so the implementation sees
the exhaustion through its own `ctx.signal`. The failure is `Timeout`.
Cancellation by the caller still gives `InternalError`; the two cases
differ by whose timer fired, not by `signal.reason`. The `timeout`
category is built in, like `internal_error`: it is not declared in
`errors:`, but it is part of the closed response set of any port.

### 4.2. Idempotency

`idempotencyKey` in `meta` exists for the `command` and `event` kinds,
both of which send a message with no response: the `EmitMeta`
dictionary is chosen by the kind of the operation (`MetaOf<C>`), and
accessing the field on a `request` is a compilation error. A command's
`emit` is always sent with a key, either passed by the caller or
generated by the caller. An event travels with a key when, and only
when, the publisher passed one: a fact has no identity of intent to
invent, and a generated key would look like a basis for deduplication
without being one. The key is stable across repeated deliveries of one
`emit`; two different `emit` calls get different keys. The key travels
in the envelope of the bus (a header, in NATS). A satellite package on
the handler's side does the deduplication
([`@nestlingjs/inbox`](../../../packages/nestling.inbox/), §2.6); the
kernel only guarantees delivering the key to the handler and the units.

The channel through which such a layer answers "already handled" is
given by the kernel as a shared one: a pre-unit finishes the endpoint
with an early success ([pipeline.md §2](./pipeline.md)). There is no
key, no storage and no retry in this channel itself, it belongs to the
pipeline.

For an effect outside the transaction, deduplication does not give
exactly-once. A message sent by the handler before the mark is
committed is sent a second time if the process crashes between the
send and the commit; the retry window narrows to this interval.

Part of the retries is removed by the broker. The NATS transport puts a
`Nats-Msg-Id` header with the idempotency key on a durable publication,
and the stream removes a repeated publication within its own
deduplication window ([transports.md §7.5](./transports.md)). This does
not replace the receipt layer: the transport has no application
transaction, so the mark and the business change are committed together
only in the layer, and a retry that arrives past the window still
reaches the subscriber.

The `meta` dictionary is the second type parameter of the caller side:
`Port<C, M>` and `Emitter<C, M>`, with `MetaOf<C>` as the default. A
satellite package declares its own dictionary by intersection
(`MetaOf<C> & { partitionKey?: string }`) and stays assignable to the
kernel type; the kernel does not put foreign fields into the envelope.

### 4.3. Two delivery channels of the profile

The first channel, unconditional, is `ctx.raw.attributes` (next to
`subject`). The second is the asynchronous context variables `Deadline`
and `IdempotencyKey`, with the standard writers `withDeadline()` and
`withIdempotencyKey()`. The variables are exported as values, so the
presence of the profile is checked at assembly:
`everyEndpoint(…).hasVar(IdempotencyKey)`. A nested call does not
inherit the budget, the same way it does not inherit `meta.signal`; a
handler that hands the remainder further on passes it explicitly.

### 4.4. Context and trace propagation

A variable declared with `{ propagate: true }` is passed across a port
boundary in the envelope of the bus (one `Nl-Ctx` header, in NATS). The
caller collects the values from the cell of the current request. "The
whole context" is never passed: `propagate` is a named exception from
the rule "the context of the caller does not reach inside the
implementation". On receipt, the values are put into
`ctx.raw.attributes`, and the standard writer `Var.propagated()` puts
them into the asynchronous context — the same two-channel receipt as
the profile. The behavior is the same for both binding paths. Details
are in [container.md](./container.md), "Asynchronous context".

The trace is propagated by the same mechanism: the kernel variable
`Trace` is declared with `{ propagate: true }`, and its value travels in
the `trace` field of the envelope. On receipt, the standard writer
`withTracing()` ([pipeline.md §3](./pipeline.md)) returns it into the
context, not `Trace.propagated()`: the same unit continues the trace
over HTTP too, so the implementation of an operation and an HTTP
endpoint are assembled from one layer.

## 5. The external client: `makeClient`

A consumer outside a Nestling process — a frontend, a service on
another stack, a script — has no access to DI. A client for it is built
from the operation:

```typescript
import { CreateUser, GetUser } from '@acme/billing-operations'; // a package with no runtime dependencies
import { makeClient } from '@nestlingjs/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },  // the consumer names the methods
  { baseUrl, fetch?, headers?, trace? },         // shared headers and a trace reader
);

const result = await api.createUser({ ... });
// Promise<Ok<Output> | Fail<EmailTaken | InternalError>>
```

- The type of the call is the same as for a port: `Ok | Fail`, the
  closed set `E ∪ InternalError`.
- The request is assembled by the bind map of the operation (path,
  query, body). The response is checked against the `output` schema
  through `~standard.validate`; the consumer brings the validator.
- Failures are restored by `code` from `errors:`; an unfamiliar code
  becomes `InternalError`.
- Headers shared by every call (auth, tracing) are set when the client
  is created. The consumer names the methods through a record; the name
  of the operation (`'users.create'`) is not parsed into the shape of
  the object.
- The `traceparent` header is set by the `trace` option — a function
  that returns a W3C trace-context string or `undefined`. The
  application supplies the reader: the client is built for a browser,
  and the ambient context of a request is not available to it. A ready
  reader is exported by `@nestlingjs/app` under the name `traceparent`.
  A header set by the `headers` field takes precedence.
- Response validation is on by default. It is turned off explicitly:
  `makeClient(record, { validateOutput: false })`.
- Query serialization is closed: `undefined` and `null` are not
  written, a scalar becomes `String(value)`, an array of scalars
  becomes repeated occurrences of the key, everything else is a
  `TypeError` at call time, naming the field. The other side of this:
  the schema of a query field must accept a string
  (`z.stringbool()`, `z.coerce.*`), because the query carries strings.
- `meta` of the client is `{ signal?, deadline? }`. `deadline` (an
  absolute moment, like at the ports) is checked before sending: an
  expired budget gives `Timeout` with no request sent over the network.
  The client has no `idempotencyKey`: there is no agreed-on HTTP slot
  for it.
- On transport failures and failures of a `request` operation, the
  client does not throw exceptions, it returns `Fail`. Exceptions
  happen only on incorrect use.
- `makeClient` rejects at creation time, naming the method key in the
  record: an operation with no `http:`, the `event` kind, a streaming
  or `multipart` io shape, a non-JSON body, a non-absolute `baseUrl`.
- `makeClient` lives in `@nestlingjs/client`: built on `fetch`, with no
  Node specifics; the package boundary is checked by the same import
  graph walk.
- For consumers not on TypeScript, there remains the path through
  OpenAPI ([transports.md](./transports.md) / the entry "Standard
  Schema…OpenAPI").
