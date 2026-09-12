# The failure model: `Fail` is a value, the list of failures is closed

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-10] Модель ошибок: Fail — значение, code-идентичность, makeFail, ошибки в операции`,
> `[2026-07-13] Типизированные клиенты из операций` (the recovery of
> `Fail` on the client),
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-08-29] Проверка входа по input: обязанность рантайма, точка после .pre-юнитов`,
> `[2026-09-03] Код отказа: категория и уточнение; makeFail`,
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`,
> `[2026-09-03] Заголовки Ok не зависят от транспорта`,
> `[2026-09-04] Отказы слоя: объявление в .pre(unit, { errors }), канал return у pre-юнита, эффективное множество errors`,
> `[2026-09-04] Output<T, E> допускает отказы ядра; void у хендлера без output`,
> `[2026-09-06] HTTP-хендлер явной формой: Handler<Op>, HttpHandler<Op>, HttpResponse; Ok без заголовков; юниты транспорта`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. `Fail` is a value; `return` is the canon, `throw` is delivery

An expected domain error is a `Fail` value. The handler returns it as an
ordinary result; for the pipeline, returning it and throwing it are
equivalent. A thrown exception that is not a `Fail` counts as an
internal error: the client gets `internal_error` with no details. The
model repeats the pair `Result` and `panic!` from Rust.

- The canon is `return`: a returned failure is visible in the `Output`
  type of the handler. `throw` is a way to deliver a `Fail` from deep in
  a call chain, where there is no one to return it to; it replaces the
  `?` operator that JS does not have. The compiler does not see a throw,
  so the runtime checks it at the boundary (§4).
- `Output<T, E> = Promise<Ok<T> | E | KernelFail | T>` (there is also
  `OutputSync`). A bare value `T` is wrapped into `Ok`. `KernelFail`
  covers the failures of the kernel (§4): a handler returns them without
  declaring them, and the boundary passes them through without a
  declaration too. `E` defaults to `never`: an endpoint with no
  `errors:` cannot return a domain failure. `E` is written by failure
  definitions: `Output<User, typeof UserNotFound | typeof EmailTaken>`.
  For a declaration with no `output`, the result type takes `void`: a
  handler with nothing to return does not write `return undefined`.
  `Ok` with no value stays allowed there too — `Ok.noContent()` and
  `new Ok(null)`; for a declaration with an `output` schema, such a
  return is a compilation error.
- The discriminant is the `isFail` field: `true as const` on `Fail`,
  `false` on `Ok`. It is serialized, unlike an `instanceof` check.
  Wrapping a failure into a success is not allowed: `new Ok(fail)` is a
  compilation error.
- A returned `Fail` goes down the error branch before the `.ok` units.
  The invariant "`.ok` sees only success" holds for both paths.
- `Fail extends Error`, so a thrown failure carries a call stack.

## 2. The failure code: category and refinement

A failure has one axis, `code`. The code consists of segments separated
by a colon; each segment matches `[a-z_]+`. The first segment is the
category, the rest refine it: `not_found:user`, `conflict:email_taken`.
A code with one category is allowed: `unauthorized`.

The list of categories is closed and does not depend on the transport:

| Category | HTTP |
|---|---|
| `bad_request` | 400 |
| `unauthorized` | 401 |
| `payment_required` | 402 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `payload_too_large` | 413 |
| `too_many_requests` | 429 |
| `internal_error` | 500 |
| `not_implemented` | 501 |
| `service_unavailable` | 503 |
| `timeout` | 504 |

- `category` is a derived field of `Fail`: the first segment of the
  code. Transports read it (to translate it into an HTTP status or a
  bus code), so do `.catch` units and the OpenAPI generator, where
  responses are grouped by category. `Fail` has no separate `status`
  field: the category is part of the code, so a code with one category
  and a status from another cannot be written.
- The type of the code is `${Category}` or `${Category}:${string}`. The
  compiler checks the category at the `makeFail` call site, the runtime
  checks the format of the segments there too.
- `cause?: unknown` is the original error, as on `Error` in ES2022.
- The serialized form (`ErrorDetails`) carries `code`, `message`,
  `details` and `requestId`. `requestId` is added by `.catch` and
  `.finally` units from the context, so the response links to the logs
  without user code. The category is not carried separately: it is
  restored from the code.
- Success statuses live on `Ok` and are written in the same register:
  `ok`, `created`, `accepted`, `no_content`. The `status` field of the
  response context is a success status or a failure category.

## 3. Domain failures: `makeFail` and identity by `code`

```typescript
export const OrderNotFound = makeFail('not_found:order', {
  details: z.object({ orderId: z.string() }),   // schema-first — details too
  message: (d) => `Order ${d.orderId} not found`,
});

return OrderNotFound({ orderId: '42' });
throw OrderNotFound({ orderId: '42' }, { cause: dbError });   // from deep in a call chain
// inside a .catch unit:
if (OrderNotFound.is(res)) { /* ... */ }        // matched by code
```

The data of a failure comes only from `details`. The constructor accepts
it with a type derived from the schema, and checks it against the
schema on the spot. `message` is a string or a function of these
details. With no schema, the constructor is called with no arguments:
`EmailTaken()`. The second argument is options, for example `cause`.

A definition is a value with the properties `code`, `category`, `schema`
and the predicate `is`; it can also be called as a function. It does not
need to be registered: it affects the application only through the
`errors:` of a declaration. Two definitions with one code are the same
failure.

A failure is recognized by `code`, not by `instanceof`. A `Fail` that
arrived from a remote port or in a client is deserialized data: it has
no class, but `code` survives. So `is` checks the code on two carriers:
a failure value (including one parsed from JSON) and the error-response
context that a `.catch` unit sees. The second carrier is described by
the minimal structural type
`{ isSuccess: false; value?: { code?: string } }`, not by the context
type of the pipeline; narrowing in `.catch` does not change because of
this.

A port and `makeClient` restore a remote failure into a real `Fail` on
their own side by one rule. `message` comes from the response, because
it describes the specific case. `details` come from the response and are
checked against the schema of the definition. When the details fail the
schema, the code is not declared in the operation, the body is not JSON,
the network is unreachable, or the response fails the `output` schema,
the client gets `InternalError` with the original in `cause`. The
response set of an external consumer is `E ∪ InternalError`, the same as
for a port. A `default` branch written for `.caller` carries over to a
client unchanged ([operations.md](./operations.md)).

## 4. Failures are part of the operation: `E ∪ InternalError`

The `errors: [EmailTaken, OrderLimitReached]` field of an endpoint or
operation declaration states which failures are possible. The failures
of pre-units are declared on the layer, when the unit is connected
([pipeline.md §3](./pipeline.md)); the effective set of an endpoint adds
up the `errors:` of its declaration and the failures of its pipeline.
The guarantee rests on two levels.

- The compiler checks everything passed by value. `makeFail` brands the
  type (`Fail<'conflict:email_taken'>`); `Output<T, E>` checks a
  `return` against the declaration, including a failure of a port
  passed through: a foreign `Fail` does not reach the response until it
  is declared. The return type of a handler is checked against the
  `errors:` list at the declaration site.
- The runtime checks the rest on the way out of the pipeline: a
  `throw`, a failure from deep in the services, a type bypass.
  Everything that reaches the exit undeclared **is replaced by
  `InternalError`** — a kernel definition with the code
  `internal_error`. A response with no code is undeclared by
  definition. The original goes in full as an `error` record into the
  kernel logger ([container.md](./container.md), "The kernel logger"):
  a fixed message, `undeclared fail normalized to internal_error`, the
  transport, the pattern and the failure code as fields, the original in
  `err`. The logger follows `dispatch`: under `App` it is
  `Logger$('nestling')`, on a standalone path the kernel default. The
  client gets a generic error body.

The set of failures reaches the runtime as a value of the declaration:
from `errors:` into `EndpointMeta`, from there into the request context.
There is no global registry, so a pipeline run with no declaration sees
an empty set.

A port call is closed by the same set and the same procedure: at the
boundary, a failure is restored by `code` from the `errors:` of the
operation, an undeclared one becomes `InternalError`, and the failures
of the kernel are part of the operation the same way
([operations.md](./operations.md)).

Summary: the response of an endpoint is the closed set `E ∪
InternalError`, where `E` combines the failures from the `errors:` of
the declaration and the failures declared by the layers of the
pipeline. `InternalError` is part of the operation of every endpoint
implicitly (the `default` response in OpenAPI). The failures of the
kernel are part of the set the same way, and they carry a bare category,
with no refinement: `BadRequest` (`bad_request`) for the input check,
`PayloadTooLarge` (`payload_too_large`) for the input size limit and the
item chains, `Timeout` (`timeout`) for the port call budget and a stream
break, `InternalError` (`internal_error`) for everything undeclared.
Kernel definitions are named after their category. There is no public
way to declare your own failure as a kernel failure; a user definition
with the same code (`makeFail('bad_request')`) is the same failure by
identity.

The check on the way out sits after all `.catch` units: `.catch` is
where an undeclared failure turns into a declared one. A forgotten
declaration shows up right away: the client gets `InternalError` (500),
not an accidentally working 404.

## 5. `Ok` statuses and HTTP metadata

`Ok` carries a value and a success status (`Ok.created(order)`); it has
no headers. Headers, cookies and a redirect are set by the
`HttpResponse` of an HTTP handler ([endpoints.md §3](./endpoints.md)); a
handler that does not depend on the transport does not set them. The
transport translates a failure category and a success status into its
own code by the table in §2.
