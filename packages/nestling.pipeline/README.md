# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoints (`makeEndpoint` / `@Endpoint`) validated against any
[Standard Schema](https://standardschema.dev), phased pipelines
(`makePipeline().pre/.ok/.catch/.after/.finally`), layer composition
(`compose`), `Ok`/`Fail` results, and streaming io modifiers
(`stream()`, `withFiles()`, `files()`).

> 🚧 Active development, API may change. The package ships **no validator
> of its own** — bring your own (zod, valibot, arktype, TypeBox, Effect
> Schema …). Design:
> [`docs/design/schemas.md`](../../docs/design/schemas.md).

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
  track with a `Fail`.
- `.ok(unit)` — success responses only; sees the **full** accumulated ctx
  (success guarantees the whole pre track ran). May replace the response
  (success with success only).
- `.catch(unit)` — error responses only; own-layer fields are `Partial`
  (enrichment may not have happened). May replace an error with an error —
  no `Fail → Ok` recovery (v1 constraint).
- `.after(unit)` — any response; `Partial` own-layer ctx.
- `.finally(unit)` — always, last, with the outcome
  (`completed | disconnected | aborted | failed`). Observer only.

Layers compose as constants — `compose(outer, ..., inner)` (pre runs
outside-in, response phases and `finally` run inside-out). A layer declares
its requirements as `makePipeline<{ identity: User }>()`; the compiler
checks them at the composition site.

Units come in three forms: a function, an instance with `handle()`, or a
class (constructor) — the latter adds the class to the pipeline's `TNeeds`
and requires `bind()` (App resolves class units from the DI container on
startup). Units are singletons; per-request state belongs in ctx only.

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
