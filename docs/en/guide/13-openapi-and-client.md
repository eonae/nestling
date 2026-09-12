# 13. Give the frontend the documentation and the client

> Guide to the current API; verified against `users-service`, `app-with-http` (2026-09-12).
> Target description: [design/schemas.md](../design/schemas.md) §2.1 and
> [design/operations.md](../design/operations.md) §5. Why: entries
> [ideas.md](../../decisions/ideas.md)
> `Схемы: Standard Schema вместо привязки к zod; OpenAPI через явные конвертеры`
> and `Типизированные клиенты из контрактов`.

The frontend team needs an OpenAPI document to look at the API and
generate code from it. A neighbouring TypeScript service needs a client
with types for requests, responses and failures. Neither the document nor
the client should be described a second time by hand: the server already
has the schemas, the addresses and the failure lists in the declarations.

```typescript
// examples/users-service/src/app.ts
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';

export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  transports: [http()],
  // …
});
```

`openapi()` is a plugin: a package that connects to the root and works for
the whole application, not for one feature. Here it is enough to put it
into `plugins:`.

The plugin builds an OpenAPI 3.1 document from the same declarations that
serve requests, and gives it out at the `GET /openapi.json` endpoint.
Three options:

- `info` — the header of the document.
- `converters` — who translates schemas into JSON Schema. The kernel
  accepts any Standard Schema validator and cannot look inside a schema,
  so the converter is named explicitly even in an application that is
  entirely on zod. A schema without a converter stops the start: the
  document is built on the ASSEMBLE phase, not on the first request to
  `/openapi.json`.
- `pipeline` — the layer for the `GET /openapi.json` endpoint. The policy
  from [chapter 10](./10-auth.md) requires `observability` from every
  HTTP endpoint, and the plugin's endpoint is no exception.

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths | keys'
# ["/users", "/users/export", "/users/import", "/users/{id}", "/users/{id}/avatar"]
curl -s http://localhost:3000/openapi.json | jq '.paths["/users"].post.responses | keys'
# ["201", "400", "401", "409", "default"]
```

The responses are derived from the declaration: `201` from the success
status, `400` for the input check, `401` and `409` from `errors:`,
`default` for `internal_error`. The `stream(User)` export shape is
described as `application/x-ndjson`.

The parameters are derived from the `bind` marks. The generator takes the
schema of a parameter from the parsed shape of the field, when it is
scalar. A query field with the `z.stringbool()` schema accepts the
strings `'true'` and `'false'`, and parses them into a `boolean`, and in
the document such a parameter is declared as boolean. In a body schema the
same field would stay a string: in JSON a value arrives as a string even
after parsing.

## The document in CI

The plugin gives out the document of a running application. In CI there is
no need to bring up the application: the document is built from the
declaration by a pure function.

```typescript
// examples/app-with-http/src/openapi.ts
import { writeFileSync } from 'node:fs';

import { app, openapiOptions } from './app.js';

import { buildOpenApiDocument } from '@nestlingjs/openapi';

/** The assembly argument is a command-line argument; without it every feature is selected */
const args = process.argv[2];

const { endpoints } = app.discover(args);

const document = buildOpenApiDocument(endpoints, openapiOptions);

// `file` is `openapi.json` in the root of the example package
writeFileSync(file, `${JSON.stringify(document, undefined, 2)}\n`);
```

`app.discover(args)` runs phase 0 and stops there: it parses the assembly
argument, expands the switch branches, resolves the feature selection and
runs discovery. It goes no further — the config sources are not brought
up, the graph is not built, the transports are not created. So the call is
synchronous, and it needs no `await`.

It needs the assembly argument for the same reason `assemble` does:
without the argument the document would describe every declared feature,
while the process would bring up only the selected ones. `app-with-http`
declares three features and the `docs` switch, and the difference shows
right away:

```bash
yarn workspace @examples/app-with-http openapi
# …/openapi.json: 11 path(s)

yarn workspace @examples/app-with-http openapi users
# …/openapi.json: 8 path(s) — the three /ops/subscriptions… paths did not make it into the document
```

The options of the document live next to the plugin as one value: `info`
and `converters` are declared in `src/app.ts` as `openapiOptions`, and the
plugin adds only `pipeline` to them. The document from CI and the document
at `GET /openapi.json` describe one API, and a second `info` is not set up
next to it.

The method throws the errors of phase 0: an unknown feature name, a switch
value outside the dictionary, a duplicate pattern on a transport instance.
Whether the graph will assemble is a question for `app.check(args)` from
[chapter 19](./19-select.md): an unsatisfied dependency and a violated
policy do not stand in the way of `discover()`.

## The `doc:` slot

JSON Schema describes the data, but not the operation itself. The name,
the tags and the success status are declared in the `doc:` slot:

```typescript
// examples/users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint.delete('/users/:id', {
  input: DeleteUserInput,
  errors: [UserNotFound],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: transactional,
  handler: DeleteUserHandler,
});
```

| Field | What it does |
|---|---|
| `summary`, `description` | the name and the description of the operation |
| `tags` | the grouping of operations in the document |
| `deprecated` | a deprecation mark |
| `status` | the status of a successful response; `ok` by default, `no_content` without `output` |
| `hidden` | the reason the endpoint does not reach the document |

`operationId` is not declared. It is taken from the name of the operation,
if the endpoint implements one, otherwise from the method and the path:
for `GET /users` this is `get_users`.

A service endpoint is removed from the document with the `hidden` field
and a reason:

```typescript
// examples/users-service/src/ops.plugin.ts
export const BuildInfo = httpEndpoint.get('/ops/version', {
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: async () => ({ version: process.env.BUILD_VERSION ?? 'dev' }),
});
```

There is no `hidden: true` form: the reason is required, as with
`detached`, and an endpoint can be hidden from the document only with one.
The plugin prints the list of hidden endpoints at start:

```
[nestling] hidden from the API document: GET /ops/version (declared in 'ops') — служебный endpoint, не часть публичного API
```

The printing is turned off by the `announceHidden: false` option.

## An operation: the address and the schemas in one place

The client needs the address, the schemas and the failure list, but not
the handler and not the dependencies. These parts move out of the
declaration into an operation:

```typescript
// examples/users-service/src/api/operations.ts
import { body, makeRequest, query } from '@nestlingjs/operations';

export const GetUserInput = z.object({ id: z.string() });

export const GetUser = makeRequest({
  name: 'users.get',
  http: 'GET /users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'Пользователь по идентификатору', tags: ['users'] },
});

export const CreateUser = makeRequest({
  name: 'users.create',
  http: {
    method: 'POST',
    path: '/users',
    bind: { dryRun: query(), name: body() },
  },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, Unauthorized],
  doc: { summary: 'Создать пользователя', tags: ['users'], status: 'created' },
});
```

An operation is a value: a name, the `input` and `output` schemas, the
`errors:` list and the `doc:` slot. The `http:` section describes the
address; an operation without it is rejected the moment the
`httpEndpoint.implement` declaration is created. The string
`'GET /users/:id'` fits an operation without marks; the `{ method, path }`
object is needed when there is a `bind`, `rawBody` or `sse`.

The `Unauthorized` failure is declared in the `errors:` of the operation
alongside `EmailTaken`: the client must know the same failures it gets
from the server, and the `authed` layer is invisible to it.

The file imports only `@nestlingjs/operations`, `zod` and the failure
definitions. It has no container, no pipeline and no transport, so it can
be imported into a frontend.

An implementation connects the operation with the transport's second
constructor:

```typescript
// examples/users-service/src/users/endpoints/get-user.endpoint.ts
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

export const GetUser = httpEndpoint.implement(GetUserOperation, {
  pipeline: observability,
  handler: GetUserHandler,
});
```

The first argument of `httpEndpoint.implement` replaces the path, the
method, `input`, `output`, `errors` and `doc`: all of it is taken from the
operation. There are no fields to declare them a second time in the
dictionary, so the server cannot diverge from the client in the schemas.
What remains is `pipeline` and `handler`. `CreateUser` in
`create-user.endpoint.ts` is built the same way: it connects the
`transactional` layer ([chapter 11](./11-database.md)) and answers with
`Ok.created`.

## The client

```typescript
// examples/users-service/src/api/client.ts
import { makeClient } from '@nestlingjs/client';

/** The consumer sets the method names: the keys of the object */
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    // A function, not an object: the headers are computed on every request
    headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ''}` }),
  },
);

async function main(): Promise<void> {
  const created = await api.createUser({
    name: 'Carol',
    email: `carol-${Date.now().toString()}@example.com`,
  });

  if (EmailTaken.is(created)) {
    console.log(`email taken: ${created.details.email}`);
    return;
  }

  if (created.isFail) {
    console.log(`request failed: ${created.code} ${created.message}`);
    return;
  }

  console.log(`created ${created.value.id}`);

  const fetched = await api.getUser({ id: created.value.id });
  // …
}

await main();
```

`makeClient(record, config)` returns an object with one method per
operation. The method names are set by the keys of the record. The client
lays the payload out over the address of the operation: `id` is
substituted into the path, the rest of the fields go into the body or the
query by the same rule the transport uses to parse a request. `makeClient`
checks the record when it is created and throws a `TypeError` naming the
method: an operation without `http:`, a streamed or `multipart` shape, a
non-absolute `baseUrl`.

A method returns `Ok` or `Fail`, not an exception. A failure is recognized
by its code through `EmailTaken.is(created)`; after serialization
`instanceof` does not work. The `details` of a restored failure are typed
by the schema from `makeFail`. Everything not declared in `errors:`,
including network errors and a body that does not match the schema,
arrives as an `InternalError` with the original in `cause`. The
`created.isFail` check closes this case too.

`headers` is a function, so the DI token is read on every request. The
client checks a successful response against the `output` schema; this is
turned off by the `validateOutput: false` option. As a second argument the
method accepts `signal` for cancellation and `deadline` for a time budget.

Start the server and the script:

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
API_TOKEN=secret yarn workspace @examples/users-service client
# created 3
# fetched Carol
```

The script imports two packages: the operations of the application and
`@nestlingjs/client`. The container, the pipeline and the transport do not
end up in its import graph.

## Check

There is no test for the document in `src/app.spec.ts`. The document is
available in the graph of the test assembly as a value under the
`OpenApiDocument$` DI token:

```typescript
// illustration; src/app.spec.ts has no such test
import { OpenApiDocument$ } from '@nestlingjs/openapi';

it('описывает каждый публичный endpoint и скрывает служебный', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const document = testApp.get(OpenApiDocument$);

  expect(Object.keys(document?.paths ?? {})).toContain('/users/{id}');
  expect(document?.paths['/health']).toBeUndefined();
});
```

The client is checked against a running server by the script from the
"The client" section.

The service grows, and a second area appears next to the users:
[chapter 14](./14-features.md).
