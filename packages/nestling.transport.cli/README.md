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

## Streaming: stdin in, NDJSON out

```ts
capabilities = {
  input:  new Set(['value', 'stream']),
  output: new Set(['value', 'stream']),
};
```

- **`stream(T)` in** reads stdin as NDJSON — one JSON value per line —
  and the kernel validates each item against the leaf schema, applies the
  item chain and counts `ctx.summary.itemsIn`.
- **`stream('binary')` in** yields stdin chunks as they arrive: a primitive
  leaf is bytes, so there is nothing to validate.
- **`stream(T)` out** writes NDJSON to stdout as the handler yields, and
  the transport closes the iterator when the stream ends or the
  transport-level signal is raised — which is what runs the deferred
  `.finally` units.
- **`events` and `multipart` are rejected at registration**: a command has
  no open connection whose disconnect would be a normal ending, and files
  arrive as paths in arguments. The error names the command, the transport,
  the slot and the form.

```ts
export const Import = cliEndpoint({
  command: 'import',
  input: stream(Row).limit(10_000).gapTimeout(30_000),
  output: z.object({ imported: z.number() }),
  handle: async (rows) => { … },
});
```

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
