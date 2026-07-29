# @nestling/transport.cli

CLI transport for Nestling: the same endpoints and pipelines as HTTP,
but commands instead of routes. Supports single-shot execution
(`cli.execute(...)`) and an interactive REPL (`cli.listen()`),
with stdin as a streaming input.

> 🚧 Active development, no tests yet, API may change. No validator among
> the dependencies — commands are validated through `@nestling/pipeline`
> against any [Standard Schema](https://standardschema.dev) you bring.

Validation failures surface as `SchemaValidationError` with
`issues: { message, path? }[]` — the Standard Schema guarantee, without
vendor-specific fields. An async schema or an object that is not a Standard
Schema is a configuration error rather than bad input, and propagates as
`AsyncSchemaNotSupportedError` / `NotAStandardSchemaError`.

Usage guide: [CLI](../../docs/guides/cli.md).
