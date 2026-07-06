# @nestling/pipeline

Typed, transport-agnostic request pipeline for Nestling: schema-first
endpoints (`makeEndpoint` / `@Endpoint`) with zod validation, typed
middleware chains (`definePipeline().use(...)`), `Ok`/`Fail` results,
and streaming io modifiers (`stream()`, `withFiles()`, `files()`).

> 🚧 Active development, API evolving. Target design (pipeline v2: phases,
> layers, `compose`) lives in
> [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[App with DI](../../docs/guides/http-app-di.md),
[CLI](../../docs/guides/cli.md).
