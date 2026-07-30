# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoint declarations (`makeEndpoint`) validated against any
[Standard Schema](https://standardschema.dev), phased pipelines
(`makePipeline().pre/.ok/.catch/.finally`), layer composition
(`compose`), `Ok`/`Fail` results with a closed error contract
(`defineFail`, `errors:`), and streaming io modifiers
(`stream()`, `withFiles()`, `files()`).

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
validation of NDJSON chunks):

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
  already-normalized response.

Layers compose as constants — `compose(outer, ..., inner)` (pre runs
outside-in, response phases and `finally` run inside-out). A layer declares
its requirements as `makePipeline<{ identity: User }>()`; the compiler
checks them at the composition site.

Units come in three forms: a function, an instance with `handle()`, or a
class (constructor) — the latter adds the class to the pipeline's `TNeeds`
and requires `bind()` (App resolves class units from the DI container on
startup). Units are singletons; per-request state belongs in ctx only.

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
- Kernel codes are in every endpoint's contract implicitly: `UNKNOWN` and
  `VALIDATION_FAILED` (the `validate()` unit) — otherwise the guard would
  turn a routine 400 into a 500. The set is closed and grows with the
  kernel only.
- `ErrorStatus` is transport-neutral semantics (`CONFLICT`, `TIMEOUT`,
  `TOO_MANY_REQUESTS`, …); mapping onto the wire is the transport's job.

Design: [`docs/design/errors.md`](../../docs/design/errors.md).

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
