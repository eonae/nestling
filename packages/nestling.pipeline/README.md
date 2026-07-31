# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoint declarations (`makeEndpoint`) validated against any
[Standard Schema](https://standardschema.dev), phased pipelines
(`makePipeline().pre/.ok/.catch/.finally`), layer composition
(`compose`), `Ok`/`Fail` results with a closed error contract
(`defineFail`, `errors:`), io declared as a **tree of forms**
(`stream()`, `events()`, `multipart()`/`upload()`) with item chains, and a
read-only ambient projection of the request context (`contextVar`, `Ctx`).

> 🚧 Active development, API may change. The package ships **no validator
> of its own** — bring your own (zod, valibot, arktype, TypeBox, Effect
> Schema …). Design:
> [`docs/design/schemas.md`](../../docs/design/schemas.md).

## Endpoint declarations are values

An endpoint declaration is a **value**, not a decorated class. `makeEndpoint`
is the kernel primitive carrying all the shared machinery; users declare
through per-transport constructors built on top of it (`httpEndpoint` from
`@nestling/transport.http`, `cliEndpoint` from `@nestling/transport.cli`).
Decorator declarations (`@Endpoint`, `@HttpEndpoint`), the `IEndpoint`
interface, `getEndpointMetadata`/`EndpointMetadata` and the global endpoint
registry are **gone**; creating a declaration has no side effects, and the
set of served endpoints comes from the tree of registered modules
(`@nestling/app`).

`handle` is accepted in three forms, told apart by its type:

| Form | Shape |
|---|---|
| plain function | `(input, meta) => …` — no dependencies, runnable as is |
| curried factory | `deps: [Token, …]` + `(…deps) => (input, meta) => …`; the outer call happens **once**, on resolution |
| class handler | a class with `@Injectable` and a `handle` method, resolved from the container |

`EndpointDefinition<I, O, P, TNeeds>` carries unresolved dependencies in
`TNeeds` (default `never`), symmetrically to `Pipeline<TReq, TAcc, TNeeds>`:
`deps` tokens, the handler class and the pipeline's class units all land
there. Transports accept only `TNeeds = never`, so handing an unresolved
declaration to `server.route(...)` is a compile error.
`endpoint.resolve(resolver)` returns a **new** runnable declaration (the
original is untouched) and binds the pipeline's class units with the same
resolver; `endpoint.resolve([instance, …])` is the positional form for
curried handlers outside a container.

Each declaration is branded with a non-enumerable
`Symbol.for('nestling:endpoint')`; `isEndpointDefinition(value)` is the
predicate discovery uses to reject anything else found in `endpoints:`.

### `binding` — an opaque carrier for the transport

`EndpointOptions`/`EndpointDefinition` accept `binding?: unknown`, which
`makeEndpoint` puts on the value and `resolve` preserves. It is where a
transport constructor stores its own binding (`httpEndpoint` puts the HTTP
bind map there, and `httpBindingOf` reads it back). **The kernel never
interprets it**: `@nestling/pipeline` knows no `path`/`query`/`body`, and
adding a transport with a different binding shape needs no kernel change.

### The start context

`makeEmptyContext(raw, endpoint, signal?, input?)` builds the initial
context. The fourth argument is the **start input** — what the transport
knows before the first pre-unit runs; it defaults to `{}`, so the context
type is `ExtendableContext<EmptyInput>` unless a transport passes
something. `@nestling/transport.http` uses it for `rawBody: true`, which
also makes the declaration's start context type non-empty — a pipeline
layer declared as `makePipeline<{ rawBody: Uint8Array }>()` then only
compiles where the bytes are actually requested.

## Schemas: Standard Schema at the boundaries

Every schema boundary of the core — `input`/`output` of an endpoint,
`EndpointMeta`, `parsePayload`/`parseMetadata`, `DomainType`, and
`Schema`/`Infer` from `@common/misc` — is typed as `StandardSchemaV1`.
Validation always goes through `schema['~standard'].validate(value)`;
the domain type is inferred via `StandardSchemaV1.InferOutput`. No vendor
type appears in a public signature, and the core never introspects a
schema — the spec gives validation and inference, nothing else.

All validation funnels through a single function, `validateSync(schema,
value, message)`, so the shape of a failure is identical on every path
(`validate()` unit, transport fallback without a pipeline, per-item
validation of NDJSON chunks, config section fields):

**The schema kernel now lives in [`@common/misc`](../common.misc).**
`validateSync`, `assertStandardSchema`, `normalizeIssues`, `DomainType` and
the three error classes below moved down a layer, because configuration is
read and validated before a request exists and `@nestling/config →
@nestling/pipeline` would invert the phase order. `@nestling/pipeline`
re-exports all of them from `./schema`, so nothing changes for a consumer:
`import { validateSync } from '@nestling/pipeline'` still resolves, to the
very same function object.


- `SchemaValidationError` — the value failed the schema. Carries
  `issues: readonly { message: string; path?: (string | number)[] }[]`,
  normalized at construction (`{ key }` segments unwrapped, symbols
  stringified, array indices kept numeric) so they are JSON-serializable.
  Transports map it to `400`.
- `AsyncSchemaNotSupportedError` — `~standard.validate` returned a Promise.
  Deliberately **not** a subclass of `SchemaValidationError`: an async
  refinement is the app author's configuration error, not bad input, so
  transports map it to `500`.
- `NotAStandardSchemaError` — the object passed as a schema has no
  `~standard` with `version: 1` (typically a validator older than
  zod 3.24 / valibot 1.0). Also `500`, with a diagnostic naming the
  likely cause.

### Migrating from the zod-bound version

- `SchemaValidationError.zodError` is gone — read `issues` instead.
- `details` in a `400` response body are `{ message, path }` objects;
  vendor-specific fields (`code`, `expected`, `received`) are no longer
  emitted.
- Async refinements in endpoint schemas are rejected: validation in the
  pipeline is synchronous by guarantee. Move an async check into a
  pipeline unit or the handler.

## Phases

One `makePipeline()` call defines one layer; the declaration reads
top-to-bottom as the execution plan:

- `.pre(unit)` — before the handler, in order; monotonically accumulates
  a typed input. A failing pre skips the handler and enters the response
  track with a `Fail`. A `Fail` **returned** by the handler enters it the
  same way — returning a failure is equivalent to throwing one.
- `.ok(unit)` — success responses only; sees the **full** accumulated ctx
  (success guarantees the whole pre track ran). May replace the response
  (success with success only).
- `.catch(unit)` — error responses only; own-layer fields are `Partial`
  (enrichment may not have happened). May replace an error with an error —
  either a full `ErrorResponseContext` or just a `Fail`, which the runtime
  normalizes the same way as the handler's. No `Fail → Ok` recovery
  (v1 constraint).
- **the contract guard** — after the whole response track and *before*
  `.finally`: a response whose code is not in `errors:` (nor a kernel code)
  is replaced by `UnknownError`. See below.
- `.finally(unit)` — always, last, with the outcome
  (`completed | disconnected | aborted | failed`). Observer only; sees the
  already-normalized response. For a **streaming** `output` it is deferred
  until the stream has finished (see below).

Layers compose as constants — `compose(outer, ..., inner)` (pre runs
outside-in, response phases and `finally` run inside-out). A layer declares
its requirements as `makePipeline<{ identity: User }>()`; the compiler
checks them at the composition site.

Units come in three forms: a function, an instance with `handle()`, or a
class (constructor) — the latter adds the class to the pipeline's `TNeeds`
and requires `bind()` (App resolves class units from the DI container on
startup). Units are singletons; per-request state belongs in ctx only.

### Composition provenance and assembly policies

A pipeline value remembers **what it was made from**: `compose(a, b)` keeps
references to its arguments, a builder derivation (`.pre`/`.ok`/`.catch`/
`.finally`) and `bind()` keep a reference to their predecessor. Nothing in
execution reads it — the provenance exists so that layer identity can be
**by reference**, which is what the policy dictionary is built on:

```typescript
import { everyEndpoint } from '@nestling/pipeline';

assemble({
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase, 'authedBase'),
  ],
  /* … */
});
```

- `everyEndpoint({ transport?, pattern? })` — the filter narrows the set
  conjunctively: `transport` is the transport **token** compared by
  reference, `pattern` is a `RegExp` over `endpoint.pattern`. An empty
  filter means every endpoint of the application.
- `.hasLayer(layer, label?)` holds when the endpoint's pipeline **derives
  from** that value. So `compose(base, authedBase)` passes, nesting is
  transitive, and `authedBase.pre(withTenant())` passes too (the pre track
  is monotonic). A same-named copy from another file does not: identity is
  referential, never by name. `label` only shows up in the violation text.
- `.hasVar(variable, label?)` holds when the endpoint's pipeline **declares**
  an ambient variable — that is, contains a pre unit of the form
  `<Var>.provide(…)`. The declared set lives next to the provenance and
  behaves the same way: `compose` unions it, builder derivations and `bind()`
  keep it. See "Ambient request context" below.
- An endpoint **without** a `pipeline` violates the policy: for "this handle
  is protected", no pipeline and no layer are indistinguishable.
- `detached: '<reason>'` on the declaration takes an endpoint out of **every**
  policy. The reason is mandatory and non-empty (`detached: true` is not
  expressible), it survives `resolve`, and `@nestling/app` prints it at
  startup and puts it in the `check()` report.

`Policy` (`describe()` + `check(subjects)`) is an open interface: a new
predicate is a value of the same type, so it needs neither a second pass over
discovery nor a second field in the composition root. Policies are run by
`@nestling/app` at the end of phase ASSEMBLE — see
[`docs/design/pipeline.md`](../../docs/design/pipeline.md) §7.

## Errors are values, and the contract is closed

A failure is an ordinary value with a stable machine `code`: `isFail` is a
plain property (it survives the wire, `instanceof` does not), and identity
is by `code`, not by class.

```typescript
export const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ orderId: z.string() }),   // schema-first, as everywhere
  message: (d) => `Order ${d.orderId} not found`,
});

export const GetOrder = httpEndpoint({
  method: 'GET',
  path: '/orders/:id',
  input: OrderId,
  output: Order,
  errors: [OrderNotFound],                      // the typed failure channel
  handle: async ({ id }, meta) => {
    const order = await orders.find(id);
    return order ? new Ok(order) : OrderNotFound({ orderId: id });
    // …or `meta.fail(OrderNotFound({ orderId: id }))` for an early exit
  },
});
```

- `Output<T, E>` / `OutputSync<T, E>` admit `Ok<T>`, a bare `T` and a
  failure from `E`. `E` defaults to **empty**: without `errors:` a handler
  cannot return a failure at all, and `new Ok(fail)` is a compile error.
- `meta.fail(e): never` is the second reserved meta key after `signal`:
  a typed early exit that only accepts declared failures.
- Anything reaching the boundary undeclared — a bare `throw`, a failure
  from deep inside a service, an anonymous `Fail.notFound(...)` (no code ⇒
  undeclared) — is normalized into `UnknownError` (`UNKNOWN`, 500). The
  original goes to `ExecuteOptions.onUnknownFail` whole (default:
  `console.error`); the client gets a generic body. No warn-and-pass.
- Kernel codes are in every endpoint's contract implicitly: `UNKNOWN`,
  `VALIDATION_FAILED` (the `validate()` unit and per-item validation),
  `STREAM_LIMIT_EXCEEDED` and `STREAM_GAP_TIMEOUT` (item-chain guards) and
  `DEADLINE_EXCEEDED` (the call budget of `@nestling/ports`) — otherwise the
  guard would turn a routine 400/413/504 into a 500. The set is closed and
  grows with the kernel only: it grows together with the mechanism that
  produces the failure, and there is no public way to mark a user code as
  built-in. `DeadlineExceeded` is defined here, not in `@nestling/ports`,
  because registering a code from another package would mean mutating a set
  that is promised closed.
- `ErrorStatus` is transport-neutral semantics (`CONFLICT`, `TIMEOUT`,
  `TOO_MANY_REQUESTS`, `PAYLOAD_TOO_LARGE`, …); mapping onto the wire is
  the transport's job.

Design: [`docs/design/errors.md`](../../docs/design/errors.md).

## io is a tree of forms

The top level of `input`/`output` is a **form**; the leaves are Standard
Schemas or the primitives `'binary'`/`'text'`. A schema on its own (and no
`input` at all) *is* the value form — there is no `value(...)` to write.

| Form | Payload | Media type |
|---|---|---|
| a schema | the value | `application/json` |
| `stream(T)` | `AsyncIterableIterator<T>`, finite data | `application/x-ndjson` |
| `events(T)` | `AsyncIterableIterator<T>`, an open subscription | `text/event-stream` |
| `multipart({ fields, files })` | `{ fields, files }` | `multipart/form-data` |

A form is an immutable value with a non-enumerable brand, so a stray
`{ kind: 'stream' }` is not mistaken for one; `describeForm(io)` is what
transports, doc generators and the runtime read, and `mediaTypeOf(io)` is
the deterministic form → media type function. `withFiles()`/`files()` and
`analyzePayload`/`PayloadConfig` are **gone**.

```typescript
input: multipart({
  fields: z.object({ id: z.string() }),
  files: { avatar: upload({ maxSize: 5 * MiB, mime: ['image/png'] }) },
}),
// payload: { fields: { id: string }, files: { avatar: FilePart } }
```

Forms are checked when the declaration is created: `multipart` in `output`,
`upload()` outside `multipart`, a streaming form without a leaf, a
type-changing chain step in `output` — each fails naming the endpoint, the
slot and the form.

### Item chains

The combinator vocabulary is closed and infrastructural — `.tap`,
`.filter`, `.limit`, `.gapTimeout`, `.throttle`, `.batch`, `.through`
(implemented in [`@nestling/streams`](../nestling.streams)). Every
combinator returns a **new** form, so chains are reusable through helper
functions:

```typescript
const guarded = <T extends Schema>(s: T) => stream(s).limit(50_000).gapTimeout(30_000);

input: guarded(LogChunk).batch(100),   // handler receives LogChunk[]
output: stream(Row).limit(100_000),    // T → T only
```

The asymmetry is expressed by the **slot type**, not by two builders:
`output` takes `StreamForm<T, T>`, `input` takes `StreamForm<T, any>`. So
`.batch(100)` in `output` is a compile error at the declaration site, and
`.through` is allowed there only in its `T → T` shape.

Per-item validation is symmetric: on input an item is validated **before**
the chain, on output **after** it (both ends of an output stream are the
wire). The policy is the form's second argument, defaulting to
`{ validate: true, onInvalid: 'fail' }`; `onInvalid: 'skip'` drops the item
on input, and on output it is ignored — silently dropping data from a
response is not on offer.

### Streaming responses finish late

For a streaming `output` the pipeline hands the transport an iterator
wrapper; closing it (normal end, error, or the consumer's `return()`) is
what computes the outcome and runs `.finally` — exactly once. Hence the
contract every transport is tested against: **consume the iterator or close
it**, including on a write error and on disconnect. Non-streaming responses
finalize as before.

`ctx.summary` (`itemsIn`/`itemsOut`, plus `bytesIn`/`bytesOut` where the
transport knows them) is a live object created with the context — available
to any unit, zeros for a non-streaming endpoint so observers never branch.

`assertFormsSupported(definition, capabilities, where?)` is the kernel-side
check a transport's `capabilities` are matched against at registration —
see [`@nestling/transport`](../nestling.transport).

Design: [`docs/design/streaming.md`](../../docs/design/streaming.md),
[`docs/design/endpoints.md`](../../docs/design/endpoints.md).

## Type diagnostics are part of the API

When a layer's requirements are not met, the parameter type collapses into
a readable literal instead of a generics trace:

```
Argument of type 'PipelineBuilder<{ identity: User; requestId: string; }, …>'
is not assignable to parameter of type '{ __error: "Layer requires context
that outer layers do not provide"; missing: { identity: User; }; }'.
```

`missing` is a **record of field name → its type**, not a union of keys: a
field that is present but of an incompatible type lands there too (with the
type the layer expects). The same shape is used everywhere the pipeline
machinery rejects an argument — the composition site, the pre track (where
overriding a field yields `conflicting: { field: [was, now] }` instead) and
the `pipeline` slot of a transport declaration (where the literal also
carries a `hint` naming the fix). In the failing branch the parameter is
**only** the error literal — no `& Pipeline<…>` tail.

The texts are pinned by snapshot tests, and the cost of the type machinery
has a budget — both live in [`type-tests/`](./type-tests):

| Path | What it is |
|---|---|
| `type-tests/fixtures/` | one file per deliberately wrong composition |
| `type-tests/__snapshots__/` | the pinned diagnostic texts; a diff catches a message degrading on a TypeScript upgrade or a types refactor |
| `type-tests/bench/` | generator of a synthetic ~50-layer graph and the budget runner |
| `type-tests/BUDGET.md` | thresholds (the runner reads them from there), the measurement log and the reasoning behind every number |

```bash
yarn workspace @nestling/pipeline type-budget          # the budget alone
yarn workspace @nestling/pipeline type-budget --report # measure, do not fail
yarn verify                                            # build + lint + test + type-budget
```

The fixtures are **meant** not to compile, so the directory is excluded
from the package `build` and `lint`.

## Ambient request context

A handler sees the accumulated `input`; a repository three layers below does
not. Instead of threading `requestId` through every signature, declare an
**ambient variable** — a typed key of that same accumulated `input`, so there
is no second state that could drift from the first:

```typescript
import { contextVar, Ctx, RequestId, Signal } from '@nestling/pipeline';
import type { CtxReader } from '@nestling/pipeline';

export const TenantId = contextVar<string>()('tenantId');   // type, then key

// Writer: the variable builds the addition from its own key, so "declared"
// and "written" are one action and cannot diverge
const withTenant = () =>
  TenantId.provide((ctx) => ctx.raw.attributes['x-tenant'] as string);

// Reader: a member of the private `Ctx` token family — an ordinary graph node
@Injectable([Ctx(RequestId), ILogger])
export class UsersRepository {
  constructor(
    private readonly requestId: CtxReader<string>,
    private readonly logger: ILoggerService,
  ) {}

  async byId(id: string) {
    this.logger.debug(`[${this.requestId.peek() ?? 'n/a'}] select ${id}`);
  }
}
```

- **The reader is a graph edge, not a global**: it shows up in `explain()` and
  in the visualization, the full set of ambient reads is known at `build()`,
  and tests substitute it with a plain `valueProvider` (`contextValue` in
  `@nestling/testing`) — no ALS needed. `Ctx` is typed by the variable value,
  so `Ctx('requestId')` with a string does not compile.
- **`get()` vs `peek()`** mirrors the pipeline's own asymmetry: `get(): T`
  throws a `ContextVarUnavailableError` whose text depends on what the runtime
  knows (no scope at all / response track, so the projection is `Partial` /
  no writer composed) and names the fix; `peek(): T | undefined` is for the
  response track, `@OnStart`, cron and background paths.
- **The cell holds** the accumulated `input`, the `signal` and the phase —
  `raw`, `endpoint` and `summary` are not exposed: the transport does not leak
  into the domain. `Signal` is a read-only well-known variable (`Ctx(Signal)`);
  the `'signal'` key is reserved, and `contextVar('signal')` fails fast.
- **The only writer of the cell is the pipeline runtime.** There is no public
  setter: ALS is a projection, not a second write channel. A scope is opened
  around the whole execution — pre track, handler, response track, `finally` —
  and, for streaming responses, around every `next()` of the returned
  iterator, so lazy generators and item chains still see it. Code deferred
  inside a request that outlives it (a timer, fire-and-forget) keeps seeing the
  cell with the final `input`; `capture()` is not part of V1.
- **`@nestling/app` registers the reader kernel module always**, the way it
  does for config: with no `Ctx(...)` in any `deps`, the family materializes
  nothing, so "always" costs nothing and the composition root says nothing
  about ambient context. An endpoint invoked without a pipeline still gets a
  scope (empty `input` + the request signal) from `@nestling/transport`.
- **One copy of the package — one ALS.** The store is module state of
  `@nestling/pipeline` (the same trick as the family registries in
  `@nestling/container`). Two copies of the package in the dependency graph
  mean two stores, and reads silently return `undefined` — keep a single
  version resolved in the workspace.
- **Presence is checkable at assembly**, opt-in:
  `everyEndpoint(…).hasVar(RequestId)`. Types already cover a unit reading
  `ctx.input.requestId` (it demands the field); the policy covers reads from
  the depth of the graph, where there are no input types at all.

## Cancellation: `meta.signal`

Every handler invocation receives a guaranteed `meta.signal: AbortSignal`
(no undefined checks needed): transports abort it on client disconnect and
on graceful shutdown, and units can read it as `ctx.signal`. When a
transport provides no signal, a never-aborted one is substituted.
Cancellation is cooperative — the handler is responsible for respecting
the signal. The `signal` key in meta is **reserved**: the pipeline injects
the context signal over any same-named field added by a pre unit.

> Design rationale (flat phases, layers, `TNeeds`, rejected alternatives)
> lives in [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[App with DI](../../docs/guides/http-app-di.md),
[CLI](../../docs/guides/cli.md).
