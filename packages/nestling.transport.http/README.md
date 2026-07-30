# @nestling/transport.http

HTTP transport for Nestling built on bare `node:http`: routing via
`find-my-way`, body parsing driven by the endpoint's io declaration
(JSON, raw, NDJSON streams, multipart via `busboy`), NDJSON streaming
responses.

## Declaring routes

`httpEndpoint({ method, path, input, output, bind, rawBody, pipeline, deps,
handle })` is the declaration constructor — a thin layer over `makeEndpoint`
from `@nestling/pipeline` that adds the HTTP dictionary and assembles
`pattern` as `` `${method} ${path}` ``. `path` is a literal type, and
`PathParams<Path>` derives the `:param` names from it. The dictionary is
checked **when the declaration is created**: an empty `path`, a `path`
without a leading `/`, a repeated path parameter and every placement rule
below all throw right there.

## Input placement: the canon and the bind map

Where each `input` field lives in the request is a deterministic function
`(path template, method, marks) → place`:

1. the field name matches a path parameter (`:id`) → **path**;
2. the field is marked in `bind` → the marked place;
3. everything else → **query** for bodyless methods (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) and **body** for the rest.

```ts
import { httpEndpoint, query } from '@nestling/transport.http';

export const CreateMember = httpEndpoint({
  method: 'POST',
  path: '/orgs/:orgId/members',
  input: MemberInput,                 // orgId → path, name → body
  bind: { dryRun: query(), tags: query({ multiple: true }) },
  …
});
```

- **Marks are values, not strings.** `query(options?)` and `body()` build
  them; the string form (`{ expand: 'query' }`) is rejected. `bind` keys are
  typed by the schema fields minus path parameters, so a typo or a mark on a
  path parameter is a compile error.
- **The map rides on the declaration value** (`httpBindingOf(definition)`):
  it is computed when the value is created, not when the app registers it —
  a client importing only the contract gets it without any server code. It
  does not enumerate every field (Standard Schema exposes no key list) but
  is total as a rule: explicit placements plus `rest`.
- **Strict intake.** The payload is assembled only from canonical places
  with a fixed priority `path > mark > rest`. A field sent to the wrong
  place does not reach the payload and fails ordinary validation. There is
  no merge-from-everywhere: `mergePayload` and `PayloadConflictError` were
  **removed** — code that caught the latter can drop the branch, code that
  relied on «a field is accepted from anywhere» must send it to its
  canonical place or declare a `bind` mark.
- **Query arrays.** A repeated key becomes an array in order (the silent
  last-wins is gone); `query({ multiple: true })` yields an array even for a
  single occurrence; zero occurrences means the field is absent, and the
  schema decides whether that is an error. Coercing wire strings
  (`?page=2` → number) is the schema author's job (`z.coerce`).
- **The body is read only when the map needs it** (rest is body, there is a
  `body()` mark, or `rawBody` is set) — a `GET` body is never buffered.
- **Fail-fast at creation**: a mark on a path parameter; `body()` on a
  bodyless method; `bind` or a path parameter with a non-structural `input`
  (`stream`/`files`/primitives); a path parameter with no `input`;
  `rawBody` together with `stream`/`files`/`withFiles`.

### `rawBody`: raw bytes in a typed start context

`rawBody: true` puts the untouched request bytes into the **start context**
(`{ rawBody: Uint8Array }`) — what webhook signature checks (HMAC) need,
since a re-serialised JSON would hash differently.

```ts
export const Hook = httpEndpoint({
  method: 'POST',
  path: '/hooks/stripe',
  input: HookEvent,
  rawBody: true,        // without it the pipeline below does not compile
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(verifySignature(secret)),
    basePipeline,
  ),
  …
});
```

A forgotten mark is a **compile error at the declaration**, not a runtime
500: the start context type depends on `rawBody`, and the `pipeline` slot
checks it. The body is read once (the value is parsed from the same bytes),
`maxBodySize` applies as usual, and memory is paid only where requested.

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
- **Input errors map to 4xx.** Malformed JSON returns `400`; oversized
  payloads return `413` — not `500`. There is no «payload source conflict»
  error any more: strict intake gives every field exactly one place.
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
