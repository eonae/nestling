# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoints (`makeEndpoint` / `@Endpoint`) with zod validation, typed
middleware chains (`definePipeline().use(...)`), `Ok`/`Fail` results,
and streaming io modifiers (`stream()`, `withFiles()`, `files()`).

## Cancellation: `meta.signal`

Every handler invocation receives a guaranteed `meta.signal: AbortSignal`
(no undefined checks needed): transports abort it on client disconnect and
on graceful shutdown, and middleware can read it as `ctx.signal`. When a
transport provides no signal, a never-aborted one is substituted.
Cancellation is cooperative — the handler is responsible for respecting
the signal. The `signal` key in meta is **reserved**: the pipeline injects
the context signal over any same-named field added by middleware.

> 🚧 Active development, API evolving. Target design (pipeline v2: phases,
> layers, `compose`) lives in
> [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[App with DI](../../docs/guides/http-app-di.md),
[CLI](../../docs/guides/cli.md).
