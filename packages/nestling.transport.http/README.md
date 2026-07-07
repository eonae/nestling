# @nestling/transport.http

HTTP transport for Nestling built on bare `node:http`: routing via
`find-my-way`, body parsing driven by the endpoint's io declaration
(JSON, raw, NDJSON streams, multipart via `busboy`), NDJSON streaming
responses.

> 🚧 Active development. CORS, rate limiting and compression are still
> out of scope. Architecture:
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
