# 3. Accept data and let no rubbish through

> Guide to the current API; verified against `e2500af3`.
> Target description: [design/endpoints.md](../design/endpoints.md),
> [design/schemas.md](../design/schemas.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-13] Канонизация HTTP-input: канон размещения + bind-карта` and
> `[2026-08-29] Проверка входа по input: обязанность рантайма, точка после .pre-шагов`.

The service needs three endpoints: `POST /users` accepts a user in the body,
`GET /users/:id` returns it by identifier, `GET /users?limit=10` returns a
list. The handler must receive data of the right type that is already checked,
and an invalid request must get `400` before the handler is called.

```typescript
// src/users/user.ts
import { z } from 'zod';

/** The user in the API responses. One schema for all endpoints. */
export const User = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.email(),
  avatarUrl: z.string().optional(),
});

export type User = z.infer<typeof User>;

/**
 * The data for creating a user: the store issues the identifier.
 *
 * `dryRun`: check the data without creating a record. The field comes
 * from the query string, the rest from the body: the `bind` mark on the
 * operation sets the place.
 */
export const CreateUserInput = User.pick({ name: true, email: true }).extend({
  dryRun: z.coerce.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;
```

The schema describes what is transmitted over the network. The type for the
handler is derived from the same schema, so there is no need to write a
separate `User` interface. An input schema is named after the operation with
the `Input` suffix: `CreateUserInput`, `ListUsersInput`
([conventions.md](../conventions.md)). Nestling accepts any schema that
implements Standard Schema: zod, valibot, arktype. The examples use zod.

```typescript
// src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint.post('/users', {
  input: CreateUserInput,
  output: User,
  handler: async (input) => ({ id: '1', ...input }),
});
```

The `input` field sets the input schema. Checking the input is a duty of the
runtime, not of the handler or a pipeline step: you cannot turn it off, and the
only way to accept any value is an explicit `z.unknown()` schema. The runtime
checks the input before the handler is called, and the handler receives data of
type `CreateUserInput`. Accessing a field that is not in the schema does not
compile. A request that does not pass the schema gets `400` with the
`urn:error:bad_request` type:

```bash
curl -X POST localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"nope"}'
# {"type":"urn:error:bad_request","title":"Bad Request","status":400,
#  "detail":"Bad request",
#  "details":[{"message":"Invalid email address","path":["email"]}]}
```

The failure body is an RFC 9457 document, described in
[chapter 4](./04-errors.md). The `details` member describes every problem in
the Standard Schema format, without fields specific to a particular
validator.

```typescript
// src/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }),
  output: User,
  handler: async ({ id }) => ({ id, name: 'Alice', email: 'alice@example.com' }),
});
```

The schema field named `id` matches the path parameter `:id`, so its value is
taken from the path. There is no need to declare separately where to read the
field from.

```typescript
// src/users/endpoints/list-users.endpoint.ts
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export const ListUsers = httpEndpoint.get('/users', {
  input: ListUsersInput,
  output: z.array(User),
  handler: async (input) => [alice, bob].slice(0, input.limit ?? 20),
});
```

The constants `alice` and `bob` stand in for the store here: the data still
lives right in the handler. `GET` has no body, so the fields of `input` are
read from the query string. The query carries strings, and the schema turns a
string into a number: `z.coerce.number()`. The request `GET /users?limit=abc`
gets `400` with the path `["limit"]` in `details`.

## The field placement rule

The fields of `input` are laid out across the parts of the HTTP request by a
fixed rule.

1. The field name matches a path parameter of the template: the field is taken
   from the path.
2. The field is marked in `bind`: the field is taken from the given place.
3. The remaining fields are taken from the query for methods without a body
   (`GET`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE`) and from the body for the
   rest.

There is no merging of fields from several places: a field is read from exactly
one place in the request, and a value from another place is not mixed in and
does not override the declared one. A `name` field sent in the query string of
`POST /users` does not reach the input data and gives a validation error.

## Marking the place: `query()` and `body()`

The default of the rule sometimes does not match the place you want. It is
natural to pass a "check only, do not write" flag in the query string, and the
user's data in the body:

```typescript
// src/api/operations.ts
export const CreateUser = httpEndpoint.post('/users', {
  bind: { dryRun: query(), name: body() },
  input: CreateUserInput,
  output: User,
  handler: async (input) => ({ id: '1', ...input }),
});
```

Now `POST /users?dryRun=true` with the body `{"name":"Carol","email":"…"}`
gives the handler `{ name: 'Carol', email: '…', dryRun: true }`. The `body()`
mark on `name` writes out loud the same thing the default would give: in a POST
request, unmarked fields are read from the body.

The marks are values from `@nestlingjs/operations`: `query()`,
`query({ multiple: true })` for a repeated parameter, and `body()`. The `bind`
map is computed when the declaration is created, so a violation of the rule
shows up right away: `body()` on a method without a body, a mark on a path
parameter, and `bind` on an unstructured input (a stream, `multipart`, raw
bytes) all give an error on import.

The marks live right in the dictionary of the declaration. In the final
example, the address and the schemas of this endpoint are moved into the
`api/operations.ts` operation (the client imports them from there too), and
`bind` is declared on it. Chapter
[14. Separate the second area](./14-features.md) introduces operations.

## How this lays out in the example

In the final example, the handlers of these three endpoints are classes that
get dependencies from the container. `GetUser` and `CreateUser` are declared
not by the per-method constructor but through an operation: the address, the
schemas and the `bind` marks are moved into `api/operations.ts`.

The test calls `GetUser` and `ListUsers` through the full pipeline without
opening a socket:

```typescript
// src/app.spec.ts
expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
```

The input data in `testApp.call` is typed by the `input` schema: you cannot
pass `{ id: 1 }` instead of a string.

```bash
API_TOKEN=secret yarn start:dev
curl localhost:3000/users/1
curl 'localhost:3000/users?limit=1'
curl -X POST 'localhost:3000/users?dryRun=true' \
  -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
```

The handler receives checked data, but it cannot yet return a failure: there
may be no user with that `id`. Next chapter:
[4. Tell the client what went wrong](./04-errors.md).

