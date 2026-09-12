# The pipeline: flat phases, layers, composition

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-06] Pipeline v2: плоские фазы, слои, композиция константами`
> (and the refinements of 2026-07-08/09),
> `[2026-07-06] Два скоупа обработки`,
> `[2026-07-10] Pipeline: отказ от .after`,
> `[2026-07-13] Бюджет на DX типов pipeline`,
> `[2026-07-14] Policy-check на собранном графе`,
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-08-29] Проверка входа по input: обязанность рантайма, точка после .pre-юнитов`,
> `[2026-09-03] Код отказа: категория и уточнение; makeFail`,
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`,
> `[2026-09-04] Отказы слоя: объявление в .pre(unit, { errors }), канал return у pre-юнита, эффективное множество errors`,
> `[2026-09-06] HTTP-хендлер явной формой: Handler<Op>, HttpHandler<Op>, HttpResponse; Ok без заголовков; юниты транспорта`,
> `[2026-09-12] Транзакционный приём: отметка в базе, слой подписчика, досрочный успех pre-юнита`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. The model: flat phases

A pipeline is the sequence of units around the handler. The units fall
into four kinds by the moment they run, and the declaration reads top
to bottom as an execution plan. There are no nested wrappers and no
`next()`: every unit has exactly one point of execution, and it is
visible from the name of the method.

A pipeline is declared with the `makePipeline()` builder. The builder is
immutable: every method returns a new pipeline.

| Method | Role | When | ctx |
|---|---|---|---|
| `.pre(u)` | preprocessor | before the handler, in declaration order | accumulated, full |
| `.ok(u)` | postprocessor | the response is `Ok` | **full** (its own layer plus the outer ones) |
| `.catch(u)` | error handler | the response is `Fail` | its own layer `Partial`, the outer ones full |
| `.finally(u)` | outcome observer | always, last | like `.catch` plus `outcome` |

The method names match the methods of `Promise`: `ok`, `catch`,
`finally`. The pipeline has no `.then`: an object with a `then` method
becomes thenable, and `await pipeline` would try to resolve it.

The pipeline has no separate notions of "middleware", "wrapper" or
"exception filter". A transaction is recorded by three explicit units:
`.pre` opens it, `.ok` commits it, `.catch` rolls it back. A centralized
error transformation is an ordinary `.catch` unit.

## 2. Executing one layer

`.pre` units run in declaration order. Each one extends the context with
typed fields; the context only grows, its fields are never removed and
never change type. A unit finishes in one of three ways: it returns an
addition to the context, a failure from the `errors` list, or the early
success `done()`. A failure and an early success are declared when the
unit is connected (§3). The runtime recognizes a returned failure by
`isFail`, an early success by `isDone`, before either one is put into
the context.

A failure means the handler is not called, and the pipeline moves
straight to the response phase with this `Fail`. A failure thrown from a
unit is handled the same way.

An early success means the remaining `.pre` units and the handler are
not called, the `input` schema check does not run, and the response
phase starts with a success with no value. For `.ok` and `.finally`
units, such a request is indistinguishable from an ordinary success: the
outcome is `completed`.

The handler runs once every `.pre` unit has passed. A failure the
handler returns is handled the same way as a failure it throws: `throw`
is only a way to deliver a `Fail` value, not a different semantics
([errors.md](./errors.md)).

After the handler, the `.ok` and `.catch` units run. They form one list
in declaration order. Before each unit, the runtime looks at the
current response: for a success, the `.ok` units run, for an error, the
`.catch` units run, the rest are skipped. A unit can change the
response. If an `.ok` unit throws, the response becomes an error, and
the `.catch` units further down the list run next. A `.catch` unit can
return a plain `Fail` with no need to assemble an `ErrorResponseContext`
by hand: the runtime handles it the same way as a `Fail` returned by the
handler.

Once the list has run, the runtime checks the response against the
effective set of failures of the endpoint: the `errors:` of the
declaration, the failures declared by the layers of its pipeline (§3),
and the failures of the kernel ([errors.md §4](./errors.md)). An error
with a code that is not in the set is replaced with `InternalError`.
The check sits after `.catch`, because `.catch` is exactly where an
undeclared error can turn into a declared one, and before `.finally`,
so `.finally` sees the response that actually reaches the client.

`.finally` units run last and get the outcome of the request:
`completed`, `disconnected`, `aborted` or `failed`.

**The moment of `.finally` depends on the shape of `output`.** For an
endpoint with an ordinary, non-streaming output, `.finally` runs right
after the response phase. For a streaming one (`stream`, `events`), the
outcome is known only after delivery, so `.finally` is delayed until
the stream ends: read to the end, broken by an error, or closed by the
consumer. The pipeline hands the transport a wrapper iterator, and
closing this wrapper runs `.finally` exactly once. Hence the duty of the
transport: consume the iterator or close it
([transports.md](./transports.md)). The output item chain and the
per-item output validation apply at the same place, when the response
is normalized ([streaming.md](./streaming.md)).

The number of items read by the time of `.finally` does not matter.
Closing the iterator before the first item runs `.finally` the same way
as closing it in the middle of a stream, and the outcome is decided by
the same rule: the signal armed by a disconnect gives `disconnected`,
armed another way gives `aborted`, not armed gives `completed`. How many
items reached the client, an observer reads from `ctx.summary.itemsOut`.

The builder tracks the order of methods: after the first `.ok`,
`.catch` or `.finally`, the `.pre` method is unavailable in the types.
So the order in which the declaration reads always matches the order of
execution.

### `ctx.summary`

`ctx.summary` is the summary of the request for observers: `itemsIn`
and `itemsOut` (counted by the item-chain runtime), `bytesIn` and
`bytesOut` (filled by the transport, when it knows them). The reference
is read-only; the values are current at the moment they are read. Every
endpoint has this field: for a non-streaming one the counters stay
zero, so an observer does not need to check the output shape.
`summary` lives in the context, not as a separate argument of
`.finally`, because `.ok` units need it too.

## 3. Layers and `compose`

One call to `makePipeline()` with a chain of methods defines one layer.
The pipeline of an endpoint is a stack of layers, assembled by the
`compose` function from constants:

```typescript
export const base = makePipeline().pre(withRequestId()).finally(audit);
export const authed = compose(
  base,
  makePipeline().pre(withIdentity()),
);
// on the endpoint: pipeline: compose(authed, makePipeline<{ identity: User }>().pre(...))
```

- `compose(outer, ..., inner)` accepts a list of layers. It reads top
  to bottom as "outside in"; `explain()` shows the layers in the same
  order.
- `.pre` units run outside in, the response units and `.finally` run
  inside out.
- A layer runs only when the `.pre` units of every outer layer have
  passed. So the response units of a layer see the context of the outer
  layers as full; `Partial` remains only for the `.pre` of its own
  layer.
- A layer declares its requirements on the outer context explicitly, as
  a type parameter: `makePipeline<{ identity: User }>()`. The compiler
  checks them at the point of composition.
- A pipeline is connected only in the declaration of an endpoint; there
  is no App level and no module level. Exported constants and factories
  are reused (`authedWith(verifyFn)`). A module with endpoints accepts a
  pipeline as a factory parameter, and the type of the parameter
  describes the required context.

### Layer failures

A failure a pre-unit may finish with is declared when the unit is
connected:

```typescript
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

- The second argument of `.pre` is a list of `makeFail` definitions. The
  unit returns a failure from this list by value, the same way a
  handler returns a failure from `errors:`. A returned failure outside
  the list is a compilation error at the `.pre` site. The failures of
  the kernel are allowed with no declaration.
- The pipeline carries the declared failures in its type, as the
  `TFails` parameter, and in its value, next to the set of declared
  variables. The rules are the same: `compose` unites them, `bind` and
  the builder's derivation keep them.
- The declaration of an endpoint adds up the effective set of failures
  from its own `errors:` and the failures of the pipeline. It goes into
  the type of the handler, into `EndpointMeta` for the boundary check,
  and into the OpenAPI document. The handler may return a failure
  declared by a layer.
- In an operation implementation (`httpEndpoint.implement(Operation, {
  pipeline })`, `implement(Operation, { pipeline })`), the failures of
  the pipeline must be part of the `errors:` of the operation: the
  operation describes everything the client will get. A violation is a
  compilation error at the declaration site, in the format of §4, with
  a hint to add the definition to the operation. The constructor
  repeats the same check when the declaration is created: it has both
  the operation and the pipeline on hand, so a separate ASSEMBLE check
  is not needed.
- A failure thrown from a unit or from deep in a call chain is not seen
  by the compiler. It must be declared by a layer or by the endpoint,
  or the boundary replaces it with `InternalError`.

### Layer early success

The right of a pre-unit to finish the endpoint with success is declared
by the same second argument of `.pre`:

```typescript
export const dedup = makePipeline()
  .pre(readIdempotencyKey())
  .pre(ClaimUnit, { done: true });
```

- The value `done()` is returned by a unit and finishes the endpoint
  with success and no value. There is no shape carrying a response
  value.
- The pipeline carries the mark in its value, next to the sets of
  declared failures and variables. The rules are the same: `compose`
  takes the disjunction, `bind` and the builder's derivation keep it.
  The type carries no such mark: a fifth type parameter of `Pipeline`
  would multiply across the overloads of `compose`, and the type budget
  is a measured threshold
  ([BUDGET.md](../../../packages/nestling.app/type-tests/BUDGET.md)).
- A declaration with such a pipeline must have no `output`: an early
  success carries no value, and `output` requires one. The check runs
  when the declaration is created, both for the shape with an
  operation and for the shape with its own address. A violation is an
  error naming the layer, the declaration and the reason.
- A unit that returns `done()` from a pipeline with no mark drops the
  request with an error. The text names the fix: connect the unit with
  `{ done: true }`.
- There is no derivation of the mark from the body of a unit: whether a
  unit will return `done()` cannot be known from its shape.

The channel is shared and belongs to the pipeline itself. Its first use
was the deduplication layer of
[`@nestlingjs/inbox`](../../../packages/nestling.inbox/), but there are
no keys, no storage and no retries in the channel itself
([operations.md §2.6](./operations.md)).

## 4. Typing

The type of the context in the response phase accounts for the fact
that `.pre` units may not have run: `.catch` and `.finally` have their
own layer of context as `Partial`. `.ok` units get a stronger
guarantee. Success comes only from the handler, and the handler runs
only after every `.pre`, so the context of `.ok` is full.

Two limits of V1 rest on this guarantee: there is no early successful
exit from `.pre` (a gate for cache or idempotency), and there is no
recovery of `Fail` into `Ok` inside `.catch`. Both would make success
possible without going through every `.pre`, and the full context of
`.ok` would stop being a guarantee.

### Type diagnostics

Type diagnostics are part of the API. When a layer's requirements are
violated, the type parameter of `compose` collapses into a readable
literal: `{ __error: '…'; missing: { identity: User } }`. The first
line of the compiler error names the problem, not a generic trace.
`missing` is a record of field names and their types. It holds both the
fields the outer layers do not give and the fields they give with an
incompatible type. The shape of the literal is one across every check
point: in `compose`, in the `.pre` chain (there the second case
describes a `conflicting` record, where the value is a pair "was,
became"), and in the `pipeline` slot of a transport declaration (there
the literal adds a `hint` field with a concrete action). On the
successful branch, the parameter is only the error literal, with no
intersection with the type of the layer.

The texts of diagnostics are fixed by snapshot tests over a directory
of fixtures with deliberately wrong compositions. The cost of the types
is bounded by a budget checked together with the rest of the
repository: deterministic compiler counters (`Instantiations`, `Types`,
by delta against an empty base) with a hard threshold, and the latency
of a real tsserver with a wide ceiling. A graph of about 50 nested
layers compiles with no `TS2589`.

## 5. Unit shapes and `TNeeds`

| Shape | TNeeds | Use |
|---|---|---|
| a function | — | the base case |
| an instance (`new WithTracing(...)`) | — | a bridge: a class with no DI |
| a class (`WithTracing`) | +Constructor | `App` resolves it from the container at start |
| a DI token (`RateLimit('strict')`) | +Token | configurable units through DI token families |
| a variable writer with dependencies (`Tx.provide([Database], compute)`) | +Token | `bind()` substitutes values from the container; the only functional shape with dependencies ([container.md](./container.md), "Asynchronous context") |
| a transport unit (`withHeader('x-tenant')`) | — | typed by the start context of the transport; allowed only in the `pipeline` slot of a transport declaration ([transports.md §1.2](./transports.md)) |

`TNeeds` is the second type parameter of the pipeline. It accumulates
the dependencies the pipeline will get later: unit classes and the DI
tokens of variable writers. A pipeline with no such units has `TNeeds`
equal to `never` (`Pipeline<…, never>`). Standalone transports accept
only such a pipeline; `run()` resolves `TNeeds` with the container on
the WIRE phase. With no container, a resolver substitutes the
dependencies: `pipeline.bind((token) => …)`. There is one resolver for
both kinds: a class unit is the DI token that the class itself serves
as. Failures declared when units are connected accumulate in a separate
type parameter, `TFails` (§3).

A unit that needs values from the container is written as a class. The
only exception is the context variable writer,
`Var.provide(deps, compute)`: a class there would exist only to move a
value through `ctx.input`. There is no public constructor of a
functional unit with dependencies for the other phases.

A unit is a singleton. The state of one request lives only in the
context.

## 6. Pipeline boundaries

- **The pipeline works with values, the transport works with bytes**
  ([transports.md](./transports.md)). Compression, CORS and content
  negotiation are not units.
- The response phase does not change the type of the response value:
  the output schema describes what goes over the network. A shared
  envelope like `{data, meta}` is part of the schema or a
  serialization option of the transport, not a unit.
- Retry and timeout are declarative options of the endpoint, run by an
  orchestrator, not wrapper units. The option is visible in the
  metadata, the documentation and the visualization.
- Logic at the level of a stream item (item validation, limits,
  timeouts) is item chains on the io declaration, not request units.
  Streams have two different processing scopes: the connection and the
  item ([streaming.md](./streaming.md)).

## 7. Introspection and policy-check

`pipeline.explain()` prints the execution plan: a tree of phases and
layers annotated with the context accumulated (`→ {identity: User}`).
It serves debugging, documentation and graph visualization.

Policy-check checks cross-cutting invariants on the assembled graph. An
invariant like "every HTTP endpoint is protected" is not expressed by
the types of the handler, so it is declared in the composition root and
checked on the ASSEMBLE phase, when every value already exists:

```typescript
makeApp({
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase, 'authedBase'),
  ],
  /* ... */
})
```

- A **filter** is two optional fields that narrow the set of endpoints
  together. `transport` is the DI token of a transport (`HttpTransport$`,
  not the `http()` provider); the comparison is by reference. `pattern`
  is a `RegExp` matched against the `endpoint.pattern` string
  (`'POST /api/users'`); a string in place of a `RegExp` is not
  accepted. An empty filter means every endpoint of the application.
- There are two predicates in V1. `hasLayer(layer, label?)` — the
  pipeline of the endpoint is composed from this layer. `hasVar(variable,
  label?)` — the pipeline declared this ambient variable
  ([container.md](./container.md)). A `.pre` unit of the
  `<Var>.provide(…)` shape counts as the declarer of a variable; the set
  of declared variables is stored on the pipeline next to its
  provenance and behaves the same way: `compose` unites it, the
  builder's derivation and `bind` keep it. A unit that puts the same
  field into the context by hand does not satisfy the predicate: the
  assembly fails, and the fix is one line.
- A layer is identified by a reference to the value, not by a name. For
  this, the pipeline keeps the provenance of the composition —
  references to the values it was built from (`compose` keeps its
  arguments, the builder's derivation and `bind` keep the predecessor).
  `hasLayer` walks this DAG and compares references. So
  `compose(base, authed)` contains both layers, a nested composition is
  transitive, and `authed.pre(x)` still contains `authed`.
- The layer label is the second, optional argument of `hasLayer(layer,
  label)`. It is used only in the violation text. The name is never
  derived automatically: not from the variable, not from
  `Function.name`, not from the stack.
- An endpoint with no `pipeline` violates any policy it falls under: for
  the invariant "the endpoint is protected", the absence of a pipeline
  and the absence of a layer are indistinguishable.
- Diagnostics are aggregated. Every policy runs, violations are grouped
  by policy. The message names the number of violations, the
  description of the policy, the pattern, the transport and the module
  of every endpoint, and both fixes: compose the layer, or mark it
  `detached`.
- The exception from the checks is `detached: '<reason>'` in the
  declaration of an endpoint. The string is required and non-empty
  (`detached: true` does not compile). The exception is total: the
  endpoint drops out of every policy. `run()` prints the list of such
  endpoints with their reasons at start, and `check()` returns them in
  its report.
- Policies run in `run()`, in `check()` and in the test root
  `assembleTest`. This is the last check of the phase: after the
  transports and the io shapes are checked, and before INIT. In CI,
  policies run through the `.check()` matrix of topologies
  ([testing.md](./testing.md)).
- The `endpoint-has-layer` ESLint rule from `@nestlingjs/eslint-plugin`
  (at the `warn` level) hints at the cases it can spot in the editor. The
  guarantee comes from policy-check: pipelines are values, they pass
  through factories and parameters, and they are not checked statically
  at the declaration site.
- A predicate is a value of type `Policy` with the methods `describe()`
  and `check(subjects)`. The same mechanism checks the presence of
  ambient variables (`hasVar`, [container.md](./container.md),
  "Asynchronous context") and the invariants of infrastructure modules,
  like "every endpoint is composed from the observability layer"
  ([composition.md §5](./composition.md)). A new predicate needs
  neither a second pass over discovery nor a new field in the root.
  Both `hasVar` and `hasLayer` rest on the state the pipeline
  accumulated at composition, not on an introspection of the graph.
  Deriving a requirement from the reachability of `Ctx(X)` is not part
  of V1 (see the journal entry).
