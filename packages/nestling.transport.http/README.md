# @nestling/transport.http

HTTP transport for Nestling built on bare `node:http`: routing via
`find-my-way`, body parsing driven by the endpoint's io declaration
(JSON, raw, NDJSON streams, multipart via `busboy`), NDJSON streaming
responses.

## Declaring routes

`httpEndpoint({ method, path, input, output, pipeline, deps, handle })` is
the declaration constructor — a thin layer over `makeEndpoint` from
`@nestling/pipeline` that adds the HTTP dictionary and assembles
`pattern` as `` `${method} ${path}` ``. `path` is a literal type, and
`PathParams<Path>` derives the `:param` names from it (the anchor the
`input-bind` change will grow the bind map on). The dictionary is checked
**when the declaration is created**: an empty `path`, a `path` without a
leading `/` and a repeated path parameter all throw right there.

The decorator API (`HttpEndpoint`, `HttpEndpointOptions`,
`HttpEndpointMetadata`, `getHttpEndpointMetadata`, `makeHttpEndpoint`,
`HttpTransport.registerEndpoint`) is **gone**. `route()`/`endpoint()` accept
only a runnable declaration — resolve dependencies first
(`endpoint.resolve(...)`) or declare the endpoint in a module and run it
under `App`.

> 🚧 Active development. CORS, rate limiting and compression are still
> out of scope. No validator among the dependencies — the transport
> validates through `@nestling/pipeline` against any
> [Standard Schema](https://standardschema.dev) you bring. Architecture:
> [`docs/design/transports.md`](../../docs/design/transports.md).

## Security & limits

By default the transport is safe to expose:

- **Internal errors are hidden.** Unhandled (non-`Fail`) errors return
  `{ "error": "Internal server error" }` with a `500` — no `message`, no
  `stack`. Set `exposeErrorDetails: true` to surface them (dev only).
  `Fail` responses always keep their `message`/`details` (the author opted in).
- **Body size is limited.** Buffered bodies (JSON/raw/text), multipart file
  size and NDJSON line length are capped at `maxBodySize` (default **1 MiB**);
  reading aborts early and returns `413`. Set `maxBodySize: 0` to disable.
- **Input errors map to 4xx.** Malformed JSON and payload key conflicts return
  `400`; oversized payloads return `413` — not `500`.
- **Validation failures return standard issues.** A schema failure returns
  `400` with `details` shaped as `[{ "message": "…", "path": ["name"] }]` —
  the Standard Schema guarantee, no vendor-specific `code`/`expected`/
  `received`. An async schema or an object that is not a Standard Schema is
  a configuration error, not bad input: those return `500`, masked by
  `exposeErrorDetails` like any other unhandled error.
- **Request cancellation.** Every request gets a `meta.signal`
  (`AbortSignal`): it aborts when the client disconnects before the
  response completes. Cancellation is cooperative — handlers (especially
  long-running or streaming ones) should respect the signal.
- **Graceful shutdown.** `close()` first aborts `meta.signal` of all
  in-flight requests (cooperative completion is the primary drain
  mechanism), stops accepting connections, drops idle keep-alive
  connections, drains in-flight requests up to `closeTimeout`
  (default **10s**), then force-closes the rest.

### Options

```ts
new HttpTransport({
  port: 3000,
  host: '0.0.0.0',
  maxBodySize: 1024 * 1024, // байт; 0 = без лимита
  exposeErrorDetails: false, // раскрывать message/stack необработанных ошибок
  requestTimeout: undefined, // node:http server.requestTimeout (мс)
  headersTimeout: undefined, // node:http server.headersTimeout (мс)
  keepAliveTimeout: undefined, // node:http server.keepAliveTimeout (мс)
  closeTimeout: 10_000, // таймаут дренажа соединений при close() (мс)
});
```

Таймауты, не заданные явно, используют дефолты Node. `close(timeout?)`
принимает разовый override таймаута дренажа.

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[App with DI](../../docs/guides/http-app-di.md).
