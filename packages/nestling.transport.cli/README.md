# @nestling/transport.cli

CLI transport for Nestling: the same endpoints and pipelines as HTTP,
but commands instead of routes. Supports single-shot execution
(`cli.execute(...)`) and an interactive REPL (`cli.listen()`),
with stdin as a streaming input.

`cliEndpoint({ command, input, output, errors, pipeline, deps, handle })` is
the declaration constructor — a thin layer over `makeEndpoint` from
`@nestling/pipeline`: `transport` is `'cli'` and the command name becomes
the handler's `pattern`. An empty command name throws when the declaration
is created. `endpoint()` accepts only a runnable declaration — resolve
dependencies first (`endpoint.resolve(...)`) or declare the command in a
module and run it under `App`.

> 🚧 Active development, API may change. No validator among
> the dependencies — commands are validated through `@nestling/pipeline`
> against any [Standard Schema](https://standardschema.dev) you bring.

Failures follow the kernel's error model: `errors:` declares the endpoint's
failure set, and anything undeclared reaching the boundary is normalized
into `UnknownError` (see [`docs/design/errors.md`](../../docs/design/errors.md)).
The status is printed as is — CLI needs no wire mapping — and the original
of a normalized failure goes to `new CliTransport(pipeline, { onUnknownFail })`.

Validation failures surface as `SchemaValidationError` with
`issues: { message, path? }[]` — the Standard Schema guarantee, without
vendor-specific fields. An async schema or an object that is not a Standard
Schema is a configuration error rather than bad input, and propagates as
`AsyncSchemaNotSupportedError` / `NotAStandardSchemaError`.

Usage guide: [CLI](../../docs/guides/cli.md).
