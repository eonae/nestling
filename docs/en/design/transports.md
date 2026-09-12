# Transports: `serve(dispatch)`, parsing, the byte level

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-08] Жизненный цикл: фазы, @OnStart/go-live, гарантия dispatch`,
> `[2026-07-13] Канонизация HTTP-input`,
> `[2026-07-13] Операция первичен` (the byte level); the boundary
> between the pipeline and the transport — Pipeline v2, the refinements
> of 2026-07-08/09; the bus and NATS — the entries of 2026-07-31.
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-09-03] Код отказа: категория и уточнение; makeFail`,
> `[2026-09-03] Заголовки Ok не зависят от транспорта`,
> `[2026-09-04] Граница @nestlingjs/transport.http: перечень обещаний и satellite-транспорт поверх тех же байтовых частей`,
> `[2026-09-05] Сигнал отмены запроса: реестр контроллеров вместо AbortSignal.any`,
> `[2026-09-06] HTTP-хендлер явной формой: Handler<Op>, HttpHandler<Op>, HttpResponse; Ok без заголовков; юниты транспорта`,
> `[2026-09-06] HTTP-сервер как ресурс: httpServer({ name }), http({ server }); дубликат паттерна на ASSEMBLE`,
> `[2026-09-06] Пробы: HealthCheck$ и Health$ в ядре, транспорты адаптируют`,
> `[2026-09-12] Транзакционный приём: inbox как вторая половина гарантии outbox'а`,
> open question 2 (the stream deduplication window and `Nats-Msg-Id`),
> `[2026-09-12] Разбор обзоров d/10 и d/13`, point 2.
> Implementation status: [roadmap](../../decisions/roadmap.md); the
> implemented behaviour of the HTTP transport is in the README of the
> `@nestlingjs/transport.http` package and the openspec specs.

A transport accepts requests from outside — over HTTP, from the
command line, from a broker — translates bytes into values, passes
them to `dispatch` and sends the response back. It is an ordinary
provider with a lifecycle ([composition.md](./composition.md)).

## 1. The place of the transport

The boundaries of responsibility:

- the pipeline and the handler work with values
  ([pipeline.md](./pipeline.md));
- everything at the byte level — parsing, framing, compression, CORS,
  content negotiation, multipart — is done by the transport;
- native objects (`IncomingMessage`, `ServerResponse` and similar)
  never leave the transport.

The interface of a transport:

- `capabilities` — the sets of io shapes the transport accepts and
  gives out (§1.1); a field of the transport declaration, not of the
  instance;
- `serve(dispatch, signal)` — the only way to start serving requests.
  There is no method for registering a single endpoint: everything the
  transport serves arrives through `dispatch`;
- `close()` — stopping: cancelling the requests in flight. The
  transport does not touch the socket: a listener opens and drains it
  (§4.2).

A listener is a node that holds the socket. Its interface in the
kernel is `listen()` and `drain()`: `listen` runs as the last step of
START, `drain` as the first step of SHUTDOWN. A transport with no
socket (CLI, the bus) has no listener at all.

The kernel builds `Dispatch` on phase WIRE (`makeDispatch`): one per
transport, only from the endpoints of that transport. The transport
gets it as the argument of `serve` on phase START. `Dispatch` consists
of two parts:

- `routes` — projections of the declarations: the pattern, the io
  shapes, the bind map, the transport fields and the declared
  failures. The projection has no executable fields (`handle`,
  `pipeline`, `deps`, `resolve`);
- `call(pattern, ctx, options?)` — executing the endpoint: choosing
  the "with a pipeline" or "without a pipeline" branch and running it.
  There is one branch for every transport; a transport does not
  duplicate it.

The transport gets only the routes and the call function, so it is
impossible to start accepting requests before START: before WIRE
there is nothing to route. The boundary option `exposeErrorDetails` is
passed as an argument of `call`: it is a setting of a particular
transport, not a property of the route table. The logger of
undeclared failures, by contrast, belongs to the table:
`makeDispatch(endpoints, { logger })` gets it once from the assembly,
and the transport needs no dependency on the logger for the sake of
one call. Transports have no output hooks: `dispatch` logs an
undeclared failure, the delivery failures of the bus are logged by its
own logger ([container.md](./container.md), "The kernel logger").

Io shapes are checked against the capabilities of the transport at two
points, by one implementation and with one error text: on phase
ASSEMBLE (`App` knows both the declarations and the transport
instances from the graph) and in `serve` before the socket opens (the
standalone path).

The standalone path uses the same primitives:

```typescript
const controller = new AbortController();
await transport.serve(makeDispatch([Ping]), controller.signal);
```

`makeDispatch` accepts only executable declarations (`TNeeds =
never`): the types cut off a declaration with unresolved dependencies.

The transport builds the request context from the data of the request
and gives it to the pipeline; it does not know about the phases of the
pipeline. The signal of a request is the signal of the request's own
`AbortController`. When the client disconnects, the transport arms it
itself; when it stops, `close()` walks the registry of controllers of
the requests in flight and arms every one. The transport creates no
composite signal per request: a registry is cheaper and does not
accumulate references on the stop signal (the entry
`[2026-09-05] Сигнал отмены запроса: реестр контроллеров вместо AbortSignal.any`).

A streaming response puts two duties on the transport. Once it gets an
iterator from the pipeline, the transport must either read it to the
end or close it (`return()`) — including on a delivery error and on a
client disconnect: closing the iterator runs the deferred `.finally`
units ([pipeline.md](./pipeline.md)). On detecting a disconnect, the
transport closes the response iterator, not only arms the signal:
otherwise an endless subscription would hold resources until garbage
collection.

The duty also applies when the signal is armed before the first frame.
A client that dropped off before the transport wrote the first item
leaves the response unread, and the iterator still needs closing:
`.finally` units run on close regardless of how many items were read
([streaming.md](./streaming.md)). The `untilAborted` operation
(`@nestlingjs/operations`), through which transports read a streaming
response, closes the source on both branches — when the signal was
armed during the iteration, and when it was armed before it began.

### 1.1 Capabilities by io shape

```typescript
interface TransportCapabilities {
  readonly input: ReadonlySet<FormKind>;    // 'value' | 'stream' | 'events' | 'multipart'
  readonly output: ReadonlySet<FormKind>;
}
```

Capabilities are data of the transport declaration (`http()`), not a
convention and not a check on the first request. The field is
mandatory: a third-party transport declares it explicitly. The check
on ASSEMBLE reads the declaration, because there is no instance yet on
this phase.

| Transport | Input | Output |
|---|---|---|
| HTTP | `value`, `stream`, `multipart` | `value`, `stream`, `events` |
| CLI | `value`, `stream` | `value`, `stream` |
| The bus/ports (V1) | `value` | `value` |

Shapes are declared on the operation, and the binding check at
assembly matches them against the capabilities of the transport. A
declaration with a shape the transport does not support fails before
it accepts requests: on phase ASSEMBLE under `App`, and in `serve` on
the standalone path. There is one check for both paths; the error text
names the endpoint, the transport, the slot and the shape, and lists
the supported shapes. The check runs on the graph, not in the types of
the declarations: a declaration does not know the type of its
transport, and this property is kept deliberately.

### 1.2 Start context and transport units

A transport exports the type of its start context: for HTTP this is
`HttpStartContext` with the headers, the method, the url and the
address of the client; the declaration marks `rawBody` and `sse` add
`rawBody` and `lastEventId` to it. A unit typed by this context knows
the transport and fits only into the `pipeline` slot of a transport
declaration: the constructors by HTTP method and
`httpEndpoint.implement` accept `Pipeline<HttpStartContext, …>`,
`implement` does not, and the compiler will not let an HTTP unit into
the implementation of an operation on the bus. A transport supplies
such units through exports: `withHeader(name)` puts a header into the
context, `withClientIp()` puts the address of the client,
`httpAccessLog(logger)` writes an access line with `bytesIn` and
`bytesOut`. The logger arrives as an argument, so the unit stays a
function and does not grow the pipeline's `TNeeds`. A transport never
attaches units implicitly: the layer is always visible in the
declaration ([pipeline.md §5](./pipeline.md)).

### 1.3 Trace propagation

Two transports propagate the trace: the bus, in the `trace` field of the
envelope, and HTTP, in the `traceparent` header in the W3C trace-context
format. On receipt, both put the value into `ctx.raw.attributes`, from
where the `withTracing()` unit reads it ([pipeline.md §3](./pipeline.md)).
No code is needed for this in the transports: HTTP puts every request
header into the attributes, and the bus puts every propagated value
under its own key.

The caller of a port and the typed HTTP client send the trace outward.
The client receives a string through the `trace` option: it is built for
a browser, and the ambient context of a request is not available to it,
so the application supplies the reader
([operations.md §5](./operations.md)).

CLI does not propagate the trace: a person launches the command, and it
has no parent span.

## 2. Accepting input: the bind map and strict acceptance

How one `input` schema is laid out across the parts of a request is
decided by the bind map of the declaration
([endpoints.md](./endpoints.md)). The constructor of the declaration
computes the map; the transport only reads it. The payload is
assembled only from canonical places, with the priority "path, then
the mark, then the rest". A field sent in the wrong place does not go
into the payload and does not go through the ordinary validation.
There is no merging "from everywhere", and no source-conflict errors
either. A repeated key in the query gives an array; `query({ multiple:
true })` gives an array even with one occurrence.

The body of the request is read only when the map requires it: the
"the rest" source points to the body, there is a `body()` mark, or
`rawBody` is on. For a `GET` with no marks, the body is not buffered.
The way the body is parsed is decided by the io shape of the
declaration (a value, `stream`, `events`, `multipart`), not by a
separate route configuration.

## 3. The byte level

Static files, a catch-all, CORS, compression, redirects, wildcard
subscriptions of the bus are not endpoints. These are the
configuration and the plugins of a transport, with no schemas and no
operations. The same goes for handling raw cases a declaration does
not fit; there is no parallel model of declarations for them
([endpoints.md](./endpoints.md)).

## 4. HTTP (`@nestlingjs/transport.http`)

- Routing is find-my-way; the patterns come from the declarations (the
  method in the name of the constructor, the path with parameters as
  the first argument).
- Parsing follows the io declaration: a JSON body; NDJSON for an input
  stream; multipart uses busboy, files are given to the handler as
  streams (`FilePart { field, filename, mime, stream }`), the limits
  (`upload({...})`) apply during parsing, with no buffering.
  `rawBody: true` puts the bytes into the typed start context in one
  read (the value is parsed from the same bytes); it is incompatible
  with streaming and multipart shapes.
- A streaming response: `stream` is served as NDJSON
  (`application/x-ndjson`, chunked); `events` as SSE
  (`text/event-stream`, `no-cache`, heartbeat comments, `id:` and
  `event:` from the `sse` section of the declaration, accepting
  `Last-Event-ID`). A mid-stream failure: for NDJSON, the connection
  breaks; for SSE, an `event: error` frame with the body of the
  failure and a close; in both cases `.finally` sees the `failed`
  outcome ([streaming.md](./streaming.md)).
- The response: the category of a failure is translated into an HTTP
  status by the table in [errors.md §2](./errors.md); headers, cookies
  and a redirect are set by the `HttpResponse` of the HTTP handler
  ([endpoints.md §3](./endpoints.md)). The transport sets
  `Content-Type` and `Content-Length` by the io shape, the handler
  does not set them.
- Protection: a body limit `maxBodySize` (an early abort, a `413`
  response); typed input errors give `400`, not `500`; configurable
  `node:http` timeouts; connection draining by the server; the details
  of unhandled 500 errors are hidden by default
  (`exposeErrorDetails`). The response to a validation error is the
  standard `issues` ([schemas.md](./schemas.md)).
- The server holds the socket (§4.2). The server reads the port and
  the host from its own configuration section (`HTTP_PORT`,
  `HTTP_HOST`); `http()` has no port option. The real address after
  the start is the server's `address()` (`null` before `listen` and
  after draining). `serve` has no arguments besides `dispatch` and
  `signal`.

### 4.1 The package boundary

The package promises: HTTP/1.1 over `node:http`; JSON, NDJSON, SSE and
multipart by io shape; `rawBody`; body and file limits; `node:http`
timeouts; connection draining on stop; the address from a
configuration section. HTTP/2, WebSocket and TLS termination are not
part of the package. A reverse proxy in front of the service, or a
separate transport, takes on these tasks.

The byte-level parts of the transport — parsing the body by io shape,
reading the bind map, the status table, NDJSON and SSE framing, the
declared io shapes — are the public surface of the package. The
package exports the status table as the `httpCodeOf` function: it
accepts a success status or a failure category
([errors.md §2](./errors.md)) and gives out an HTTP code. The OpenAPI
generator reads the same function, so the document and the response
never drift apart. A transport on top of another HTTP server is
written as a satellite on top of these, and touches neither the kernel
nor `transport.http`. If an export is missing for this, the fix adds
an export, not a change to the satellite.

### 4.2 The server as a resource

`httpServer({ name? })` is a resource ([container.md](./container.md))
that holds an `http.Server`. It is declared in the root's
`transports:`. It reads the port and the host from a family section by
its own name: `HTTP_PORT` and `HTTP_HOST` for the default server,
`HTTP_ADMIN_PORT` and `HTTP_ADMIN_HOST` for `name: 'admin'`.
`http({ server })` attaches to the server; with no `server`, the
transport declares its own server with the same name as itself.
Several transports on one socket get one server: `http({ server: api
})` and `graphql({ server: api })`.

The handlers line up in a chain, in the order they attach. A handler
reports whether it took the request; a request no one took gets `404`
from the server. Without such a mark, two transports on one socket
would be impossible: the first would answer `404` on the other's
routes.

The phases: on INIT the server is created with no listening; on START
the transports attach their handlers in `serve`, after which the
servers open the socket — `listen` runs last; on SHUTDOWN the servers
are the first to stop accepting connections and drain the open ones
(`drain`), the transports cancel the requests in flight next
(`close`), and the resource's `release` lets go of the socket handle.
An ephemeral port in tests is `HTTP_PORT=0` through `vars`. TLS is not
part of the package (§4.1).

Draining is bounded in time. `close()` first arms `meta.signal` of
every active request, then closes the idle keep-alive connections and
waits for the active ones to finish, up to `closeTimeout` — 10 seconds
by default. The remaining connections are closed forcibly. An open
`events` connection finishes the same way: the signal closes the
response iterator, and `.finally` sees `aborted`.

### 4.3 Probes

`httpProbes()` is a plugin of the package with two endpoints,
`GET /healthz` and `GET /readyz`. They read the kernel node `Health$`
([composition.md §6](./composition.md)), have no pipeline, and are
marked `detached` and `hidden`. `readyz` answers 200 for the `ready`
outcome and 503 for `not_ready`; the body carries a report with the
names of the checks and their outcomes.

## 5. CLI (`@nestlingjs/transport.cli`)

CLI has commands instead of routes: `pattern` sets the name of the
command. What "accepting requests" means for the command line is
decided by the `serve` mode: `'argv'` — one call over the arguments of
the process, `'repl'` — reading commands from stdin until `exit`. Both
branches run the endpoint through `dispatch.call`; `execute({ command,
args, options })` stays the public entry point for a single call, for
the root and for tests. Collecting missing input by the schema is the
`missing: 'prompt'` binding policy ([endpoints.md](./endpoints.md),
§6). The transport builds the plan of questions in `serve` from the
JSON Schema of the `input` shape; a converter from
`cli({ converters })`, chosen by the vendor of the schema, gives it. A
command with a stream on the input does not accept the policy: the
questions and the stream read the same input.

The input, output and error streams are transport options (`input`,
`output`, `errorOutput`); the defaults are the channels of the
process. The input stream also serves as the input of the command:
`stream(T)` reads NDJSON lines, `stream('binary')` reads chunks as
they are; the streaming output is written in the same NDJSON. CLI
supports neither `events` nor `multipart`: a command has no open
connection whose disconnect would be a normal completion, and files
arrive as paths in the arguments.

## 6. The bus (`@nestlingjs/app`)

`InProcessBus` is a transport with two interfaces: an incoming one
(`ITransport`, the routes of operation implementations) and an
outgoing one (`IMessageBus`, the callers). There is no separate "bus
transport" entity next to the bus.

The bus differs from the other transports in two ways. First: the
routes subscribe on phase WIRE, not in `serve`. `@OnStart` can already
call a port, and the transports start accepting after `@OnStart`;
`serve` stays the point where the signal of the application connects
to the stop channel of the bus. Second: the in-process bus is not
listed in the root — the kernel module of the callers registers it. It
appears in the graph only if there is at least one operation
implementation, or the root assigned the intercom role (§7).

Io shapes are only `value` in both directions: an operation with
`stream` or `events` is rejected on ASSEMBLE by the same shape check.
Details are in [operations.md](./operations.md).

The bus declares two capabilities as values: `remote` (does it deliver
outside the process) and `durable` (can it deliver durably). The first
is an input of caller binding ([operations.md](./operations.md) §3).
The second decides the visible degradation: an application with
`durable` operations on a bus with no durability starts, but at start
prints a line listing the operations served with no durability. Both
capabilities are false for `InProcessBus`.

## 7. NATS (`@nestlingjs/transport.nats`)

`NatsBus` is the same kind of value with two interfaces as the
in-process bus, and under the same DI token. It is declared like any
other instance: `nats({ name: 'events' })` in the root's
`transports:`. It becomes the carrier of operations when the root
assigns it the role — `intercom: 'events'`. The role opens the branch
"the root supplied the bus": the kernel module of the callers then
does not register its own implementation, because there is exactly
one bus in the application, and a broker is not added to the
in-process bus, it replaces it.

A declared bus with no assigned role is an assembly error: the
connection is occupied, and there is nothing to carry. Only transports
that implement `IMessageBus` can take the role; HTTP cannot, and the
compiler checks this.

Not one `implement(...)` declaration, not one operation and not one
call changes when it is connected — this is the L4 level from
[composition.md](./composition.md).

### 7.1 Addressing

The subject is the name of the operation (with a prefix, if
`NATS_SUBJECT_PREFIX` is set). The delivery group is computed by the
same map as the in-process bus: `owner:<subject>` for
`request`/`command`, the name of the subscriber for `event`. Adding a
replica needs no configuration change.

### 7.2 Phases

For a broker, the phases are distinguished more precisely than for the
in-process bus. The connection opens on INIT (it is a resource).
`attach(dispatch)` on WIRE remembers the routes and checks the io
shapes. Subscriptions are created in `serve` — after `@OnStart`, so an
incoming message never catches an unfinished `@OnStart`. On SHUTDOWN
the transport drains the processing and returns the unacknowledged
durable messages to the stream.

### 7.3 The message format

The body is encoded by a codec (JSON by default; the codec is replaced
by a factory option). The envelope travels in headers: a relative
`timeoutMs`, `idempotencyKey`, the propagated context together with the
trace. The context travels in one `Nl-Ctx` header as a whole JSON
object: the broker canonicalizes header names, and the key of a
variable in a header name would not survive. The req-reply response is
a `ResponseContext` with the same codec, so a declared `Fail` is
restored by code through the same procedure as locally.

A durable publication with an idempotency key additionally carries the
broker header `Nats-Msg-Id` with the same value: the stream uses it to
remove a repeated publication within its own deduplication window
(§7.5). Core publications and req-reply have no such header. Core NATS
does not remove retries, and the header there would promise a
guarantee that does not exist.

### 7.4 The waiting ceiling

A request through a broker is never infinite. A call with no
`meta.deadline` is bounded by `NATS_REQUEST_TIMEOUT` (30 s by
default); a call with a budget gets `min(remainder, ceiling)`. The
ceiling is not a default budget. The budget belongs to the call and
travels inward; the ceiling belongs to the transport, like the socket
timeout of an HTTP server. The difference is visible in the text of
the failure.

### 7.5 Durability

`durable: true` is declared on the operation (only `command` and
`event`), and NATS serves such subjects through JetStream: the stream
is derived from the subject, the durable consumer from the group;
`ack` is sent on the fact of a decision (a success and a declared
`Fail` are treated the same); where a decision was not reached, the
message is delivered again. An existing stream that covers the subject
is accepted as is; a stream with the same name and a conflicting set
of subjects fails the assembly.

The stream definition the transport creates carries a deduplication
window. The value comes from the factory option `dedupeWindowMs`, the
default is 5 minutes. The broker removes a repeated publication with
the same `Nats-Msg-Id` within the window by itself: the message does
not go into the stream and does not reach the subscriber. The default
is chosen by the retry cycle of the outbox relay: it takes around 122
seconds with the defaults of the `outbox` section. A value of `0`
turns off deduplication — the field is not set in the stream
definition.

The transport does not rewrite the window of an existing stream:
retention, storage and the limits stay the operator's area. A window
narrower than configured gives a `warn` entry with the name of the
stream and both numbers — one per stream. There is no assembly
failure here: a narrow window means part of the retries reach the
subscriber, and this is today's behaviour, closed by transactional
receipt ([operations.md](./operations.md), the "Transactional
receipt" topic).

The window gives no "exactly once" guarantee. The transport has no
application transaction, so a retry that arrives past the window still
reaches the subscriber. The receipt layer stays mandatory regardless
of the window.

### 7.6 The boundary with the broker

The specifics of the broker (wildcard, ack, KV, ordered consumers)
reach neither `IMessageBus` nor the API of operations: the kernel
knows only the interface ([operations.md](./operations.md)). Byte-level
tasks are solved by the same subscription method: a wildcard auditor
injects `MessageBus$` and calls `subscribe('orders.>', …)` in
`@OnStart`; there is no third kind of declaration for this. Wildcard
is a capability of the broker: the in-process bus treats a subject
literally.

The broker client is isolated behind a narrow connector (`connect` is
a factory option). The seam of the connector is three names:
`NatsConnector` (the function itself), `NatsConnectOptions` (its
argument) and `NatsLike` (the list of the broker verbs the transport
rests on). The remaining types of the seam are parts of `NatsLike`,
and a substitute for your own client does not need to name them. The
in-memory double of the broker is exported by the `./testing`
convention: the tests of the application and the package pass with no
network, and a separate integration run checks compatibility with the
real broker.

## 8. MCP (`@nestlingjs/mcp`)

MCP is an inbound protocol: the agent sends `tools/call`, the server
picks the route, runs it through the pipeline and answers. That is how a
transport is built, so `mcp(...)` is declared in `transports:` of the
root next to `http()`.

```typescript
const api = httpServer();

makeApp({
  features: [UsersFeature],
  transports: [
    api,
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
      converters: [zodConverter()],
    }),
  ],
});
```

The transport opens no socket. `server` takes the declaration of an HTTP
server, the handler joins its chain, and the port stays one for both
protocols — the same mechanism as in §4.2. The handler takes `POST` and
`DELETE` on `path` (`/mcp` by default) and passes everything else down
the chain.

A tool is an endpoint of that transport, and it is declared the way any
other endpoint is: `mcpTool('search_users', { … })` together with the
schemas, `mcpTool.implement(CreateUser, { … })` for a declared operation
([endpoints.md](./endpoints.md), §1). There is no second list of the
composition: the tools lie in `endpoints:` of the features and are seen
where the HTTP endpoints are. The call is run by `dispatch.call`, so the
tool goes through the pipeline of its declaration, its layers and its
policies.

The capabilities of the transport are `value` both ways: the arguments
and the result of a tool call are values. A tool with a stream or a
`multipart` form is rejected by the kernel form check (§1.1).

The definitions that reach the agent in `tools/list` are built in `serve`
from `dispatch.routes`, that is before `listen`. The schemas are
translated by `leafJsonSchema` with the converters from
`mcp({ converters })` — the same ones the OpenAPI generator takes. The
violations of a declaration are collected and thrown as one list: a tool
with no description, a non-object input schema, a schema with no
converter. Uniqueness of the name is checked by the kernel on ASSEMBLE as
uniqueness of the «transport instance, pattern» pair, so the package
needs no name check of its own.

The name, the description and the hints for the agent travel in the
`binding` of the declaration: the route projection carries no `doc`
section (§1). The name of a tool is its `pattern`, and in the
`implement` form it is derived from the name of the operation by
replacing the dots with underscores: `users.create` gives `users_create`.

`Ok` reaches the agent as the result of the call: the value as JSON text
in `content` and, when an `outputSchema` is declared, in
`structuredContent`. `Fail` reaches it as the same result with
`isError: true` and a text that names the code, the message and the
details of the failure. A failure does not become a protocol error: a
declared failure is part of the contract of the operation, and the agent
has to read it.

The client sessions are the state of the transport instance:
`initialize` opens a session and returns its id in the `Mcp-Session-Id`
header, and `close()` on SHUTDOWN clears the map. The number of sessions
and the idle time are limited by options.

One operation can be served both over HTTP and by a tool. The ban on two
owners fires on two bus bindings, while these declarations have different
transport bindings, so `httpEndpoint.implement(CreateUser, …)` and
`mcpTool.implement(CreateUser, …)` live in one application with one
handler class.
