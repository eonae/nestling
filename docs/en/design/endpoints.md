# Endpoint declarations

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-13] Один канонический стиль деклараций`,
> `[2026-07-13] Endpoint-декларации: per-transport конструкторы, deps-инжект, формы хендлера`,
> `[2026-07-13] Канонизация HTTP-input: канон размещения + bind-карта`,
> `[2026-07-13] Операция первичен: онтология деклараций, три этажа, формы io`.
> Deferred (`header()`, typed response headers):
> [deferred](../../decisions/deferred.md),
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-08-29] Проверка входа по input: обязанность рантайма, точка после .pre-шагов`,
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`,
> `[2026-09-04] Две формы хендлера: функция без зависимостей и класс`,
> `[2026-09-04] Отказы слоя: объявление в .pre(step, { errors }), канал return у pre-шага, эффективное множество errors`,
> `[2026-09-06] Ресурсы и роли классов: @Component, @Resource, @Handler; экземпляры на INIT`,
> `[2026-09-06] HTTP-хендлер явной формой: Handler<Op>, HttpHandler<Op>, HttpResponse; Ok без заголовков; шаги транспорта`,
> `[2026-09-06] HTTP-сервер как ресурс: httpServer({ name }), http({ server }); дубликат паттерна на BUILD`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. Three levels of declarations

Everything the application serves is described at one of three levels.

1. **The byte level of the transport** — static files, CORS,
   compression, wildcard subscriptions. These are settings and plugins
   of the transport; there are no schemas and no operations here
   ([transports.md](./transports.md)). Cases that do not fit into
   schemas are handled at this level; there is no separate declaration
   model for them.
2. **Operations** — every operation with schemas: the interface
   (`input`, `output`, `errors`) and the addresses (`name`, `http:`,
   `cli:`, …) ([operations.md](./operations.md)).
3. **Implementations** — `implement(Operation, { pipeline?, handler,
   subscriber? })`. The `subscriber` field sets the subscription
   address: it is required for an event operation and forbidden for the
   other kinds ([operations.md](./operations.md)).

The operation comes first. The transport constructors
(`httpEndpoint.<method>`, `cliEndpoint`, …) are a shorthand for "an
anonymous operation plus `implement` in one call". The address comes as
the first argument: for HTTP the constructor itself names the method,
and the path is its first argument; for CLI the first argument is the
command name. An operation with a declared address is implemented by
the second constructor of the transport:
`httpEndpoint.implement(Operation, { … })`. At the kernel level, every
declaration compiles into the same graph node.

An endpoint differs from an operation only in visibility. An exported,
named operation is callable: through `.caller`, clients, the intercom,
with versions. An anonymous declaration is only a transport surface. To
make an endpoint callable, it is enough to give it the name of an
operation and export it.

There are no decorator declarations (`@Endpoint`, `@HttpEndpoint`), no
`IEndpoint` interface and no global registry of endpoints. The canonical
style of declaration is functional (`make*`). Classes are used where DI
is needed: providers, steps, handlers.

## 2. Declaration: a value created by a transport constructor

```typescript
export const CreateOrder = httpEndpoint.post('/orders', {
  input: NewOrder,
  output: Order,
  errors: [OrderLimitReached],       // the typed channel E (errors.md)
  pipeline: basePipeline,
  handler: CreateOrderHandler,       // a class with @Handler([OrdersService]), see §3
});
```

**Transport fields.** The address and the other fields of a specific
transport are allowed only in the declaration and are typed:
path parameters are derived from the template in the first argument,
the placement rule and the bind map (§4) are computed in the
constructor. The HTTP method is not a field in the dictionary: the name
of the constructor names it. The pipeline and the handler know nothing
about the transport; the operation does not depend on the transport.

**`makeEndpoint`.** This is a kernel primitive that the transport
constructors are built from; it does not appear in user code. All the
shared code lives in it: normalizing the forms of `handler`, getting
dependencies from the container, the brand, `errors:`, `doc:`,
`detached`. A transport constructor adds only its own fields.

**Checks at creation time.** Fields are checked at the moment the
declaration is created, not when the application is built. These
give an error right away: an empty path, a path with no leading `/`, a
repeated path parameter, an empty command name. The `errors:` list is
checked there too: an element not created by `makeFail`, and a repeated
`code`, give an error naming the endpoint and the offending value. The
`doc:` section rejects an unknown field and `hidden: true`; the `detached`
mark rejects a non-string and an empty reason. The declaration of
successful outcomes is checked there too (§5). Checks that need to match the path
template against the schema live at the level of the bind map (§4):
Standard Schema does not give out a list of keys.

**`errors:`.** This is a field the kernel interprets, unlike an opaque
binding. The failure type of the handler is derived from it, and it is
passed through `EndpointMeta` into the check of the operation's
failures on the way out of the pipeline. It is joined by the failures
declared by the layers of the pipeline
([pipeline.md §3](./pipeline.md)). In an operation implementation, the
failures of the pipeline must be part of the `errors:` of the
operation, or the declaration does not compile. Transport constructors
only pass the field through.

**`detached: '<reason>'`.** This mark takes an endpoint out from under
every build invariant ([pipeline.md §7](./pipeline.md)). The field
does not depend on the transport and lives in the kernel. Its type is
`string`: `detached: true` does not compile, and the runtime rejects a
non-string and an empty string when the declaration is created. The
kernel carries the reason over to the value and keeps it through
`resolve`, like `binding` and `errors:`.

**`doc:`.** The documentation section: `summary`, `description`, `tags`,
`deprecated`, `hidden: '<reason>'`. It does not depend on the transport or
on the documentation format. The kernel does
not interpret it: no path of request execution depends on it; the
kernel carries the section over to the value and keeps it at `resolve`,
like `binding`. Description generators read it
([schemas.md §2.2](./schemas.md)). There are no fields in the section
meaningful only for one format; for example, `operationId` is derived,
not declared. In an operation implementation, the section belongs to
the operation, next to `input`, `output` and `errors`.

**`status:`.** The field names the status of the single successful
outcome: `ok`, `created`, `accepted` or `no_content`. This is the response
contract on the wire: the runtime, the documentation generator and the
typed client read it. With no field the default applies: `ok` when
`output` is declared, `no_content` without it. Several outcomes are
declared by a branching `output` (§5), and the field is not declared next
to it.

**Brand.** A declaration carries a symbol brand. The value stays an
ordinary object: a spread, `Object.keys` and serialization do not see
the brand. An element of `endpoints:` with no brand drops the start,
naming the declaring unit and the position in the array; it is not
skipped silently.

**Reference to the transport** is the DI token of an **instance**. A
declaration picks its instance with the `on:` field (`on: 'admin'`);
without it, this is `'default'`. An endpoint whose instance is not in
the graph drops the build on the BUILD phase.

**Several transports.** The canon is a named operation with several
bindings and one `implement`. Several thin declarations sharing a
handler are an option for anonymous surfaces with different field
sets. Every declaration knows its own transport.

**Graph node.** An endpoint is an ordinary graph node with a synthetic
id (`endpoint:POST /orders`). The dependency edges of the handler are
visible in the visualization and in `explain()`; cycles are checked as
for any node. The node appears in the graph on the BUILD phase, the
pattern is registered on the WIRE phase.

**Order of declarations.** Endpoints have no order: the order in
`endpoints:` and the order of the features do not affect routing. The
HTTP transport looks up a route through a tree of patterns, and a
static segment wins over a parameter regardless of which declaration
was registered first. Two declarations with the same pattern on the
same transport instance are a BUILD error naming both units
([transports.md](./transports.md)).

## 3. The `handler` field: shapes and interfaces

Everything about execution lives in the `handler` field. The
declaration describes the address, the schemas, the failures and the
pipeline; the dependencies belong to the handler, not to the
declaration. The rule matches the rule for pipeline steps: the class
gets the dependencies from the container.

| Shape | When |
|---|---|
| `handler: (input, meta) => …` | no dependencies. The only shape standalone transports accept (`server.route`): an endpoint with dependencies does not fit there by type |
| `handler: Class` | a class with `@Handler([deps])` and a `handle` method. The endpoint creates the instance itself: it becomes the provider of this class, and the class does not need to be registered in `providers:`; a handler class in `providers:` does not compile ([container.md](./container.md)) |
| an HTTP handler | a function or a class whose `meta` contains `http`, and whose result is `HttpOutput`. Allowed only in the constructors by HTTP method (below) |

In both shapes, `meta` contains the reserved key `signal: AbortSignal`
(request cancellation) and the context fields accumulated by `.pre`
steps; the type of this object is `HandlerMeta`. If a pre-step added a
`signal` field, the injection overrides it. The return type is checked
against both the `output` schema and the `errors:` list, at the
declaration site ([errors.md](./errors.md)). A failure is returned by
value; `throw` is delivery from deep in a call chain
([errors.md §1](./errors.md)).

The class shape is the canon for application code: it keeps the
familiar post-NestJS structure of "constructor plus method", but with
no decorator declaration. The `Handler<typeof Op>` interface is derived
from the operation: the types of the input, the result and the failures
come from it and are not rewritten by hand. `implements` gives
autocompletion and an early error in the class; the final check against
the schemas stays in the `handler:` slot, because the constructor by
method has no operation.

```typescript
@Handler([OrdersService, ChargeCard.caller])
export class CreateOrderHandler implements Handler<typeof CreateOrder> {
  constructor(
    private orders: OrdersService,
    private billing: Port<typeof ChargeCard>,
  ) {}
  async handle(input: NewOrder, meta: HandlerMeta) { /* ... */ }
}

export const CreateOrderImpl = implement(CreateOrder, {
  pipeline: basePipeline,
  handler: CreateOrderHandler,   // a class — a field of the typed call:
});                              // the check against the schemas sits at the declaration site
```

A unit test of the handler needs no framework: the class is created
through `new CreateOrderHandler(fakes…)`, the function is called
directly. Such a test has no imports from `@nestlingjs/*`.

### The HTTP handler

A handler that needs the HTTP metadata of the request or an
HTTP-specific response declares this by its signature: `meta` of type
`HttpHandlerMeta` with an `http: HttpRequest` field (headers, method,
url, client address), and a result of `HttpOutput<T, E>`. `HttpOutput`
is `Output<T, E>` plus `HttpResponse`.
`HttpResponse.redirect(location, { status?, headers?, cookies? })` gives
a redirect, `HttpResponse.of(ok, { headers?, cookies? })` gives an
ordinary response with headers.

```typescript
@Handler([Sessions])
export class LoginHandler implements HttpHandler<typeof Login> {
  constructor(private sessions: Sessions) {}
  async handle(
    input: Credentials,
    meta: HttpHandlerMeta,
  ): HttpOutput<never, typeof BadCredentials> {
    const session = await this.sessions.open(input, meta.http.ip);
    if (session.isFail) return session;
    return HttpResponse.redirect('/app', { cookies: [session.cookie] });
  }
}
```

The constructors by HTTP method accept both shapes. `httpEndpoint.implement`
and `implement` accept only a handler with no `http` in `meta`: a class
with HTTP metadata does not fit there by type, and the impossibility of
reusing it on the bus is visible at compile time. `Ok` carries no
headers; success statuses (`Ok.created`) do not depend on the transport
and remain the same for both shapes. A redirect in the OpenAPI document
is a 3xx response with a `Location` header.

**Unresolved dependencies in the type.** The type of an endpoint
contains everything not yet obtained from the container: the handler
class and the classes of the pipeline steps. `server.route()` accepts
only an endpoint with none of them, the same way as `Pipeline<any,
never>`. The dependencies are obtained in one step,
`endpoint.resolve(resolver)`; the same call connects the pipeline steps
with the same resolver. `App` does this on the WIRE phase for every
discovered declaration.

## 4. HTTP: the placement of `input` fields and the bind map

The `input` schema is one for every transport. Where each of its fields
goes in the HTTP request is decided by a deterministic rule from the
path template, the method and the marks:

1. a field name matches a path parameter of the template — the field
   comes from the path;
2. a field is marked with `query(...)` or `body()` — from the named
   place;
3. the remaining fields come from the query for methods with no body
   (`GET`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE`) and from the body for
   the other methods;
4. headers are read only by a mark, never by default. In V1 there is no
   `header()` mark ([deferred](../../decisions/deferred.md)).

```typescript
export const CreateUser = httpEndpoint.post('/users/:orgId/members', {
  input: z.object({
    orgId: z.string(),                     // matches :orgId → the path
    name: z.string(),                      // POST → the body
    dryRun: z.stringbool().optional(),     // marked below → the query
    tags: z.array(z.string()).optional(),  // ?tags=a&tags=b
  }),
  bind: { dryRun: query(), tags: query({ multiple: true }) },
  output: User,
  pipeline: basePipeline,
  handler: AddMemberHandler,   // a class with @Handler([UserService])
});
```

**A mark is a value.** `query(options?)` and `body()` are exported mark
constructors. A string shape like `{ expand: 'query' }` is not accepted.
The keys of `bind` are typed by the fields of the schema minus the path
parameters: a typo in a key and a mark on a path parameter are
compilation errors.

**The bind map.** The placement rule and the marks unfold into a flat
map, "explicit placements plus a rule for the rest of the fields". This
happens when the declaration or the operation is created, not when it
is registered in `App`. The transport, the OpenAPI generator and the
typed client read the map; the client gets it from one import of the
operation, with no server code. The map cannot list every field (there
is no schema introspection), but every field has exactly one place.

**Strict acceptance.** The payload is built only from the canonical
places. A field sent to the wrong place does not reach the payload and
does not go through ordinary validation. There is no merging "a field
is accepted from everywhere", and no source-conflict errors. The
request body is read only when the map requires it.

**Errors at declaration creation.** A mark on a path-parameter field;
`body()` on a method with no body; `bind` or a path parameter with a
non-structural `input` (a streaming shape, a primitive); a path
parameter with no `input`; `rawBody` together with a streaming or
multipart shape. For `multipart`, the fields of the form play the role
of the structural `input`: path parameters and marked query fields are
added to `fields`. The case "a path parameter is declared, but the
schema has no field with that name" is not diagnosed in general,
because Standard Schema does not give out a list of keys
([schemas.md](./schemas.md)). Diagnostics exist where a vendor
converter exists ([schemas.md §2.1](./schemas.md)).

**Arrays in the query.** A repeated key gives an array in the order the
values appear; the last value does not overwrite the previous ones.
`query({ multiple: true })` gives an array even for one occurrence.
Zero occurrences means the field is absent; the schema decides whether
it is required. Converting query strings to numbers and booleans
(`?page=2`) is done by the schema (`z.coerce`), not by the transport.

**Context headers.** `Authorization`, `traceparent` and similar headers
are request context; they reach `meta` through pre-steps. `Accept` and
`Content-Type` are handled by the transport; they do not reach the
handler.

## 5. Io shapes: a tree of shapes over schemas

`input` and `output` are not always one schema. The top level of a
declaration is a shape; the leaves are Standard Schema. The
specification of the schemas for values is not affected by this.

| Shape | Semantics | HTTP media type |
|---|---|---|
| a value (the schema as is) | an ordinary request or response | JSON |
| `stream(T)` | a finite stream | NDJSON / chunked |
| `events(T)` | an open subscription | `text/event-stream` (SSE) |
| `multipart({ fields, files })` | fields plus files | `multipart/form-data` |

A shape is an immutable branded value: an arbitrary object with a
`kind` field is not accepted as a shape. A bare schema and the absence
of `input` are the value shape; there is no separate `value(...)`
constructor.

The check runs at runtime before the handler
([pipeline.md](./pipeline.md)), and it depends on the shape: a value is
checked whole, the items of `stream` and `events` one at a time, while
they are read. For `multipart`, the fields are checked by the `fields`
schema in the same place, at runtime, while the files
(`upload({ maxSize, mime })`) are limited by the transport while
parsing, with no buffering. The semantics of streams and item chains
are described in [streaming.md](./streaming.md).

The correspondence between shapes and media types is deterministic; it
serves as the input for OpenAPI generation.

At declaration creation, the following are rejected: `multipart` in
`output`; `upload()` outside `multipart`; a streaming shape with no
leaf; an item-chain step that changes the type (`.batch`) in `output`.
The error text names the endpoint, the slot and the shape.

### Branching outcomes: `outputs({ … })`

The `output` slot also takes a branching declaration — several successful
outcomes, each with its own status and its own shape:

```typescript
output: outputs({ ok: User, accepted: JobAccepted, no_content: none() })
```

The keys of the branching are statuses from the kernel dictionary, the
values are io shapes: a schema, a primitive, or `none()` for an outcome
with no body. The keys are the declared set of statuses, so the `status`
field is not declared next to the branching. `none()` is valid only inside
a branching: a declaration with no body is written by leaving out
`output`.

The handler result type of a branching declaration is a discriminated
union of `Ok` by status. The check `result.status === 'accepted'` narrows
`value` to the type of that branch; a bare value without the `Ok` wrapper
does not compile under a branching, because the execution path picks the
outcome. Under a single outcome a bare value is allowed and takes the
declared status from the runtime.

The document describes every outcome on its own: its code, its schema and
its media type ([schemas.md §2.2](./schemas.md)). The response is
validated by the shape of the outcome whose status the result carries, and
an `Ok` with a status outside the declared set is replaced by the boundary
with `internal_error` — the same way it treats an undeclared failure
([errors.md](./errors.md)).

A streaming shape is declared as the only outcome
([streaming.md §2](./streaming.md)).

At declaration creation, the following are rejected: an empty branching
and a branching with a single key; a key outside the dictionary of
successful statuses; `status` together with a branching; `status` next to
`redirect`; `none()` outside a branching; `status: 'no_content'` with a
declared `output`. The error text names the declaration, the field and the
allowed values.

### `multipart({ fields, files })` and `upload(...)`

```typescript
input: multipart({
  fields: z.object({ id: z.string(), title: z.string() }),  // optional
  files: { avatar: upload({ maxSize: 5 * MiB, mime: ['image/png', 'image/jpeg'] }) },
})
// payload: { fields: { id: string; title: string }, files: { avatar: FilePart } }
```

- `upload({ maxSize, mime, multiple })` describes a file field.
  `multiple: true` gives `FilePart[]`, otherwise one `FilePart`, and a
  second file with the same name is rejected. An undeclared file field
  is rejected too.
- The limits apply while parsing: exceeding `maxSize` stops reading
  this file (`payload_too_large`, 413); a `mime` mismatch gives a
  failure before the body is read (400).
- The keys of `files` type the payload: the names of the file fields
  are known statically. A file field name matching a `fields` field
  name is a compilation error.
- The shape is allowed only on the input side: it has no value shape.

### SSE specifics: the `sse` field of the HTTP declaration

The `events(T)` shape does not depend on the transport, so everything
related to delivering events over HTTP is declared in the fields of the
HTTP declaration:

```typescript
@Handler([ActivityHub])
export class ActivityStreamHandler {
  constructor(private hub: ActivityHub) {}

  async handle(
    _payload: unknown,
    meta: { signal: AbortSignal; lastEventId?: string },
  ) {
    return new Ok(this.hub.subscribe(meta.signal));
  }
}

export const ActivityStream = httpEndpoint.get('/activity/live', {
  output: events(ActivityEvent),
  sse: { id: (e) => e.id, event: (e) => e.kind, heartbeat: 15_000 },
  pipeline: basePipeline,
  handler: ActivityStreamHandler,
});
```

- When `id` or `event` are not set, the corresponding frame fields are
  not written. When `heartbeat` is not set, the transport option is
  used. The event name `error` is reserved for a failure in the middle
  of a stream and is rejected at declaration creation. `sse` with no
  `events` output is an error too.
- Reconnection: the `Last-Event-ID` header reaches the typed start
  context (`lastEventId?: string`) of declarations with an `events`
  output. This is the same mechanism as `rawBody: true`; there is no
  separate channel. The handler decides where to continue the stream
  from.

### Raw bytes: `rawBody`

The `rawBody: true` mark on an HTTP declaration turns on access to the
bytes of the body (webhook signatures, HMAC). The transport puts the
bytes into the typed start context; the check layer declares
`makePipeline<{ rawBody: Uint8Array }>()`. A forgotten mark is caught by
the compiler at the declaration site, on the `pipeline` slot. The body
is read once: the value is parsed from the same bytes, the
`maxBodySize` limit works as usual. Memory is spent only for
declarations with this mark.

### Checking a shape against the transport

An operation can declare any shape. On the BUILD phase, the binding
is checked against the capabilities of the transport, and a mismatch
drops the build with an error naming the operation, the transport
and the shape. HTTP supports streams and multipart; the bus and the
ports in V1 support only value shapes.

## 6. CLI binding

A `cliEndpoint` declaration consists of a command name and the same io
declaration. How to gather a missing `input` is decided by the binding
policy, not by the operation. `missing: 'prompt'` derives questions from
the schema: an enum becomes a choice from a list, a boolean a
confirmation, `description` a hint, the `default` of a node the value
on "Enter". A question is asked only for a required field missing from
the arguments; the answer is placed in the same shape a flag would have
given it. In CI mode, questions are turned off: a missing flag is an
error. A dialogue in the middle of execution is expressed by a pair of
plan/apply operations; this pattern of a confirmable operation does not
depend on the transport. An operation always remains a function
`input → output`.
