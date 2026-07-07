# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoints (`makeEndpoint` / `@Endpoint`) with zod validation, phased
pipelines (`makePipeline().pre/.ok/.catch/.after/.finally`), layer
composition (`compose`), `Ok`/`Fail` results, and streaming io modifiers
(`stream()`, `withFiles()`, `files()`).

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
