# 4. Tell the client what went wrong

> Guide to the current API; verified against `9d9a2e03`.
> Target description: [design/errors.md](../design/errors.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-10] Модель ошибок: Fail — значение, code-идентичность, makeFail, ошибки в контракте`,
> `[2026-09-03] Код отказа: категория и уточнение; makeFail` and
> `[2026-09-06] HTTP-хендлер явной формой: Handler<Op>, HttpHandler<Op>, HttpResponse; Ok без заголовков; шаги транспорта`.

`GET /users/:id` must answer `404` if there is no such user, and `POST /users`
must answer `409` if the email is taken. The client must tell these cases apart
by the machine code, not by the message text. Creation must answer `201` with a
`Location` header, deletion must answer `204`.

```typescript
// src/users/users.errors.ts
import { makeFail } from '@nestlingjs/operations';
import { z } from 'zod';

export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Category `conflict`: a taken email is a conflict with the data, not a format error */
export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});
```

`makeFail` declares a failure: a machine code, a details schema and a message.
The result is called as a function and returns a failure value:
`UserNotFound({ id })`.

The failure code is its only axis. It consists of segments separated by a
colon. The first segment is the category, the rest refine it. The category says
how to answer, the refinement says what exactly happened. The client compares
the full code, the transport reads the category, and the category never
disagrees with the code: it is the code's first segment, so declaring a failure
with the code `not_found:user` and answering `409` is impossible.

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

The list is closed, and the compiler checks the category:
`makeFail('gone:user')` does not compile. The format of the remaining segments
is `[a-z_]+`, and `makeFail` checks it on call. A code with only one category
is allowed when there is nothing to refine: `makeFail('unauthorized')`.

```typescript
// src/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  handler: async ({ id }) => (id === '1' ? alice : UserNotFound({ id })),
});
```

The constant `alice` stands in for the store: it sits right in the handler. The
`errors` field lists the failures that the endpoint may return. The handler
returns a failure as a value, like an ordinary result. The client gets a
failure document:

```bash
curl -i localhost:3000/users/9
# HTTP/1.1 404 Not Found
# content-type: application/problem+json
#
# {"type":"urn:error:not_found:user","title":"Not Found","status":404,
#  "detail":"User 9 not found","details":{"id":"9"}}
```

The failure body is an RFC 9457 document under the
`application/problem+json` media type. The machine-readable code travels in
the `type` member with the `urn:error:` prefix, the message in `detail`, the
details in `details`. A ready-made library on any stack parses such a body,
instead of code written for our own format. `title` and `status` describe the
response itself: the HTTP status phrase and its code. The shape is the same
for every failure of the boundary — the handler's response, a broken JSON
body and the error frame of a stream alike.

A failure is delivered by `return`: the returned failure is visible in the type
of the handler, and the compiler checks it against the `errors` list. From deep
inside a call chain, where there is no one to return a value to, a failure is
thrown: `throw UserNotFound({ id })`. For the response it is the same thing,
and appendix A describes throwing in more detail.

The type of the return value is written with the failure definitions:

```typescript
// src/users/endpoints/get-user.endpoint.ts
async function handle(input: GetUserInput): Output<User, typeof UserNotFound> {
  const user = await users.byId(input.id);

  return user ?? UserNotFound({ id: input.id });
}
```

`Output<T, E>` describes everything a handler can return: a value `T`, `Ok<T>`,
a failure from `E` or a kernel failure. `E` takes the definitions themselves:
`Output<User, typeof UserNotFound | typeof EmailTaken>` for two failures.
Without `errors` the set is empty: a handler that returns a domain failure not
included in `errors` does not compile. Kernel failures need no declaration,
neither here nor in `errors`. Their list follows below.

An endpoint without `output` has no value, and the handler compiles without a
`return`.

## Success with a status

```typescript
// src/users/endpoints/create-user.endpoint.ts
async function handle(input: CreateUserInput): Output<User, typeof EmailTaken> {
  if (await users.byEmail(input.email)) {
    return EmailTaken({ email: input.email });
  }

  const user = await users.insert(input);

  // the `created` status is part of the processing result, not the transport
  return Ok.created(user);
}
```

A bare value from the handler turns into `Ok` with the `ok` status. When
another status is needed, the handler returns `Ok` explicitly:
`Ok.created(value)` answers `201`, `Ok.accepted(value)` answers `202`.

`Ok` carries no headers: `Location` and `Set-Cookie` make sense only in HTTP,
while the handler of an operation is portable across transports. The header,
the cookie and the redirect are set by the HTTP shape of the response,
`HttpResponse` from `@nestlingjs/transport.http` ([chapter 10](./10-auth.md)).
It is allowed where the address is declared by the transport:

```typescript
return HttpResponse.of(Ok.created(user), {
  headers: { Location: `/users/${user.id}` },
});
```

```typescript
// src/users/endpoints/delete-user.endpoint.ts
async function handle(
  input: DeleteUserInput,
): Output<null, typeof UserNotFound> {
  const removed = await users.remove(input.id);

  return removed ? Ok.noContent() : UserNotFound({ id: input.id });
}
```

`Ok.noContent()` answers `204` with no body. The `DeleteUser` declaration has
no `output` field.

```typescript
// src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint.delete('/users/:id', {
  input: DeleteUserInput,
  errors: [UserNotFound],
  handler: async ({ id }) =>
    (await remove(id)) ? Ok.noContent() : UserNotFound({ id }),
});
```

In the final file, `DeleteUser` also has an `authed` layer: deletion requires a
Bearer token. The `Unauthorized` failure is declared by the layer itself, so it
does not appear in `errors:` ([chapter 10](./10-auth.md)).

```bash
API_TOKEN=secret yarn start:dev
curl -X DELETE localhost:3000/users/2 -H 'authorization: Bearer secret' -i
```

## An undeclared error

Everything that reaches the boundary of the pipeline without being declared in
`errors`, the client gets as `internal_error` with the `500` status: a thrown
exception, a failure from deep inside the service, a failure that is not on the
list. The original error goes into the server log, and the response body is
generic. This way the details of internal errors do not leak outward.

Kernel failures are on the list of every endpoint without a declaration, both
at the boundary and in the `Output` type. Each of them carries a bare category:

| Definition | Code | When |
|---|---|---|
| `BadRequest` | `bad_request` | the input did not pass the schema, the request did not parse |
| `PayloadTooLarge` | `payload_too_large` | the body, the file or the stream is bigger than allowed |
| `Timeout` | `timeout` | the call budget ran out, the stream was silent longer than allowed |
| `InternalError` | `internal_error` | everything undeclared |

The response of `testApp.call` carries the failure code, and its `status`
equals the category of that code:

```typescript
// src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

A failure is recognized by its code, not by its class: the `code` field
survives serialization, and `UserNotFound.is(value)` works even where the
original error class is absent. A unit test of the handler checks a failure the
same way, without the application:

```typescript
// src/users/endpoints/create-user.endpoint.spec.ts
const result = await handler.handle({ name: 'Alice II', email: alice.email });

expect(EmailTaken.is(result)).toBe(true);
expect(result).toMatchObject({
  code: 'conflict:email_taken',
  details: { email: alice.email },
});
```

For now, handlers live as functions in the dictionary of the declaration. The
next chapter moves them into classes:
[5. A handler as a class](./05-handler-class.md).

