# @nestling/transport.http

HTTP transport for Nestling built on bare `node:http`: routing via
`find-my-way`, body parsing driven by the endpoint's io declaration
(JSON, raw, NDJSON streams, multipart via `busboy`), and response framing
picked from the same declaration — NDJSON for `stream(T)`, SSE for
`events(T)`.

## Declaring routes

Two forms of the same constructor. The **contract form**
`httpEndpoint({ contract, deps?, pipeline?, handle, detached? })` takes the
address, the schemas, `errors:` and `doc:` from a contract that carries an
`http:` section — `method`/`path`/`bind`/`rawBody`/`sse`/`input`/`output`/
`errors`/`doc` are declared `never` in its dictionary, so redeclaring what
belongs to the contract is a compile error (and a runtime one for a JS
consumer). The bind map is carried over from the contract
**as the same value**, never recomputed: that is what makes "one map on both
ends of the wire" a matter of identity rather than of two computations
agreeing.

The **anonymous form**
`httpEndpoint({ method, path, input, output, bind, rawBody, pipeline, deps,
doc, handle })` is the declaration constructor — a thin layer over `makeEndpoint`
from `@nestling/pipeline` that adds the HTTP dictionary and assembles
`pattern` as `` `${method} ${path}` ``. The placement marks `query()`/`body()`
and the bind map type live in [`@nestling/contracts`](../nestling.contracts)
(the map is needed by the client too) and are re-exported from here, so the
author of a declaration takes them from the same place as `httpEndpoint`. `path` is a literal type, and
`PathParams<Path>` derives the `:param` names from it. The dictionary is
checked **when the declaration is created**: an empty `path`, a `path`
without a leading `/`, a repeated path parameter, a malformed `doc:` section
and every placement rule below all throw right there. The transport does not
interpret `doc:` — it only forwards it to `makeEndpoint`; reading it is the
business of a document generator ([`@nestling/openapi`](../nestling.openapi)).

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
  (a streaming form, primitives); a path parameter with no `input`;
  `rawBody` together with a streaming or multipart form; an `sse` section
  without an `events` output, or an `sse.event` producing the reserved name
  `error`. For `multipart` the structural part is `fields`: path parameters
  and marked query fields are mixed into it.

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
checks it. The diagnostic uses the same shape as the rest of the pipeline
machinery (see `@nestling/pipeline`), plus a `hint` naming the fix:

```
'{ __error: "Pipeline requires context that the start context does not
provide"; missing: { rawBody: Uint8Array; }; hint: "declare 'rawBody: true',
or provide the fields from an outer layer"; }'
```

The body is read once (the value is parsed from the same bytes),
`maxBodySize` applies as usual, and memory is paid only where requested.

## Streaming: NDJSON, SSE and multipart

The transport declares what it can carry, and registration is checked
against it **before the server starts listening**:

```ts
capabilities = {
  input:  new Set(['value', 'stream', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};
```

- **`stream(T)` out** → `application/x-ndjson`, chunked, one JSON per line.
- **`events(T)` out** → `text/event-stream` with `cache-control: no-cache`.
  Frame fields come from the declaration's `sse` section, which is where
  wire specifics belong — the form itself stays transport-neutral:

  ```ts
  export const Activity = httpEndpoint({
    method: 'GET',
    path: '/activity/live',
    output: events(ActivityEvent),
    sse: { id: (e) => e.id, event: (e) => e.kind, heartbeat: 15_000 },
    handle: (hub) => async (_p, meta: { signal: AbortSignal; lastEventId?: string }) =>
      new Ok(hub.subscribe(meta.signal)),
  });
  ```

  Heartbeat defaults to the transport's `sseHeartbeat` (15s; `0` disables)
  and is written as an SSE comment, so it never counts as an item.
  `Last-Event-ID` arrives in the **typed start context** (`lastEventId?:
  string`) of any declaration with an `events` output — the same mechanism
  as `rawBody`, no separate channel.
- **`stream(T)` in** → NDJSON is decoded into a stream of values; per-item
  validation, the item chain and the counters are the kernel's job
  (`bindInputStream`), not the parser's.
- **`multipart({ fields, files })` in** → files are delivered under the
  declared field names, and each `upload({ maxSize, mime })` is enforced
  **while parsing**: an oversized file aborts its own read (`413`), a wrong
  MIME is rejected before the body is read (`400`), an undeclared file
  field and a second file in a single-valued field are rejected (`400`).

**Mid-stream failures.** Once the headers are out the status cannot change,
so NDJSON responses are cut off (the client sees an unterminated chunked
body) and SSE responses get an `event: error` frame carrying the failure
body before the connection closes. Either way `.finally` sees `failed`, and
an undeclared failure is normalized into `UnknownError` as usual.

**Closing the iterator.** On disconnect, on a write error and on `close()`
the transport closes the response iterator (`return()`), which is what runs
the deferred `.finally` units and detaches `Topic` subscriptions. Input
streams are drained on failure so the connection is not left half-read.

## Going live: `serve(dispatch, signal)`

```ts
const server = new HttpTransport({ port: 3000 });
const shutdown = new AbortController();

await server.serve(makeDispatch([SayHello, CreateUser]), shutdown.signal);
```

`serve` is the **only** entry point: neither a nullary `listen()` nor a
per-endpoint registration method exists. Routes arrive as projections in
`dispatch.routes`, and the endpoint is executed by `dispatch.call` — the
transport keeps the plumbing (parsing, framing, `sendResponse`, multipart
draining) and no copy of the execution branch. Under `assemble` the same
`dispatch` is built in phase WIRE.

`address()` returns the actual bound address after go-live (`null` before
`serve` and after `close()`) — which is what a `port: 0` test needs, since
`serve` takes no host/port arguments.

The registration and decorator APIs (`route()`, `endpoint()`,
`HttpEndpoint`, `HttpEndpointOptions`, `HttpEndpointMetadata`,
`getHttpEndpointMetadata`, `makeHttpEndpoint`,
`HttpTransport.registerEndpoint`) are **gone**. `makeDispatch` accepts only
runnable declarations — resolve dependencies first
(`endpoint.resolve(...)`) or declare the endpoint in a module and run it
under `assemble`.

## As a provider: `http(options?)`

```ts
await assemble({ modules: [UsersModule], transports: [http({ port: 3000 })] }).run();
```

`http()` returns a **provider**, not an instance: the transport is an
ordinary graph node whose dependencies the container injects and whose
lifecycle runs with the rest. Port and host come from the package's own
config section (`HTTP_PORT`, `HTTP_HOST`); the priority is explicit factory
options > config > transport default. Only the `keys` handle
(`httpConfigKeys`) is exported — the section token stays private.

> 🚧 Active development. CORS, rate limiting and compression are still
> out of scope. No validator among the dependencies — the transport
> validates through `@nestling/pipeline` against any
> [Standard Schema](https://standardschema.dev) you bring. Architecture:
> [`docs/design/transports.md`](../../docs/design/transports.md).

## Security & limits

By default the transport is safe to expose:

- **Internal errors are hidden.** Unhandled errors and *undeclared*
  failures return `{ "error": "Internal server error", "code": "UNKNOWN" }`
  with a `500` — no `message`, no `stack`. Set `exposeErrorDetails: true`
  to surface them (dev only). Only a **declared** failure (its `code` is in
  the endpoint's `errors:`, or it is a kernel code) keeps its
  `message`/`code`/`details`: that disclosure is the author's opt-in. The
  original of a normalized failure goes to `onUnknownFail` (default:
  `console.error`).
- **Body size is limited.** Buffered bodies (JSON/raw/text) and NDJSON line
  length are capped at `maxBodySize` (default **1 MiB**); reading aborts
  early and returns `413`. Set `maxBodySize: 0` to disable. A multipart file
  is capped by its own `upload({ maxSize })` and falls back to `maxBodySize`
  when the field declares none. Heartbeat comments do not count towards any
  limit.
- **Input errors map to 4xx.** Malformed JSON returns `400`; oversized
  payloads return `413` — not `500`. There is no «payload source conflict»
  error any more: strict intake gives every field exactly one place.
- **Semantic statuses map onto the wire here**, not in the kernel:
  `CONFLICT → 409`, `PAYLOAD_TOO_LARGE → 413`, `TOO_MANY_REQUESTS → 429`,
  `TIMEOUT → 504` (a budget overrun, not a client that failed to finish
  sending — that would be 408). An item chain's `.limit(n)` and
  `.gapTimeout(ms)` land on 413 and 504 through those. The table is exported
  as `httpCodeOf(status)` for its second reader — the OpenAPI generator: a
  document must name the codes that actually go out, and a second copy of the
  table would drift from this one at the first addition to the vocabulary.
- **Validation failures return standard issues.** A schema failure returns
  `400` with `"code": "VALIDATION_FAILED"` and `details` shaped as
  `[{ "message": "…", "path": ["name"] }]` — the Standard Schema guarantee,
  no vendor-specific `code`/`expected`/`received` inside the items. The
  code is set on both paths (the pipeline's `validate()` unit and the
  no-pipeline fallback), so one concern does not answer with two bodies. An async schema or an object that is not a Standard Schema is
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
  (default **10s**), then force-closes the rest. Open `events`
  connections end this way too: the signal closes the response iterator,
  and `.finally` observes `aborted`.

### Options

```ts
new HttpTransport({
  port: 3000,
  host: '0.0.0.0',
  maxBodySize: 1024 * 1024, // байт; 0 = без лимита
  exposeErrorDetails: false, // раскрывать message/stack необработанных ошибок
  onUnknownFail: undefined, // хук стража: оригинал снятого отказа (дефолт — console.error)
  requestTimeout: undefined, // node:http server.requestTimeout (мс)
  headersTimeout: undefined, // node:http server.headersTimeout (мс)
  keepAliveTimeout: undefined, // node:http server.keepAliveTimeout (мс)
  closeTimeout: 10_000, // таймаут дренажа соединений при close() (мс)
  sseHeartbeat: 15_000, // период heartbeat-комментариев SSE (мс); 0 = выключить
});
```

Таймауты, не заданные явно, используют дефолты Node. `close(timeout?)`
принимает разовый override таймаута дренажа.

Usage guides: [functional HTTP](../../docs/guides/http-functional.md),
[app with DI](../../docs/guides/http-app-di.md),
[composition root](../../docs/guides/composition.md).
