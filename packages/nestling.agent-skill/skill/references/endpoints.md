# Endpoints

An endpoint is a value that carries an address, an input schema, an output
schema, the failures it may answer with, and a handler. It is exported from
its own file and listed in `endpoints:` of a feature. Names live in the
README of [`@nestlingjs/transport.http`](https://www.npmjs.com/package/@nestlingjs/transport.http)
and [`@nestlingjs/operations`](https://www.npmjs.com/package/@nestlingjs/operations).

## Declared inline

Use the inline form while the address is server-side only.

<!-- snippet: list-users.endpoint.ts -->
```typescript
import { User } from './api-operations.js';
import { observability } from './pipeline.js';

import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const page: z.infer<typeof User>[] = [
  { id: '1', name: 'Alice', email: 'a@example.com' },
];

/**
 * The address and the schemas are declared inline: an operation is only
 * needed when a client or a neighbouring feature calls the same thing.
 *
 * `limit` is not in the path and `GET` has no body, so it comes from the
 * query string. A function handler cannot inject anything — take a handler
 * class as soon as it needs a dependency.
 *
 * `pipeline:` names a layer the application already declares: the policy of
 * the root requires this one from every HTTP endpoint.
 */
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  pipeline: observability,
  handler: async ({ limit }) => page.slice(0, limit),
});
```

`input` is a Standard Schema — zod, valibot or arktype. The request is
validated against it before the handler runs, so the handler receives a
value of the inferred type and never checks it again.

Where a field comes from follows one rule: a name declared in the path is
taken from the path, a method without a body takes the rest from the query
string, and a method with a body takes the rest from the body. `bind`
overrides the placement for one field.

## Declared as an operation

When the same call is made by a browser client or by a neighbouring
feature, the address and the schemas move into an operation. Both sides
import the operation, so the client cannot drift from the server.

<!-- snippet: api-operations.ts -->
```typescript
import { EmailTaken, Unauthorized, UserNotFound } from './errors.js';
import { QuotaExceeded } from './intercom-operations.js';

import { makeRequest, query } from '@nestlingjs/operations';
import { z } from 'zod';

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
});

export type User = z.infer<typeof User>;

export const GetUserInput = z.object({ id: z.string() });

export type GetUserInput = z.infer<typeof GetUserInput>;

/** `id` is taken from the path because the path declares `:id` */
export const GetUser = makeRequest({
  name: 'users.get',
  http: 'GET /users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'User by id', tags: ['users'] },
});

export const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  // Query carries strings, so `z.stringbool()`: `z.boolean()` would reject
  // `?dryRun=true`
  dryRun: z.stringbool().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;

/**
 * `errors:` lists the failures of the handler, of a neighbouring feature
 * and of the `authed` layer: the client must know the same set the server
 * can answer with. `bind` moves one field out of its default place — for a
 * POST that is the body.
 */
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded, Unauthorized],
  doc: { summary: 'Create user', tags: ['users'], status: 'created' },
});
```

The file with operations imports only `@nestlingjs/operations`, the schemas
and the failure definitions. That keeps it importable from a frontend
bundle, which is the reason it exists.

`doc:` feeds the OpenAPI document, which is built from the same
declarations that validate requests.

## Two forms of handler

A function handler is enough while nothing has to be injected.

```
handler: async ({ id }) => ({ id, name: 'Alice' })
```

A class handler is used as soon as a dependency appears. The class is
marked `@Handler([…])`, the method is always `handle`, and the endpoint
takes the class itself — not an instance.

<!-- snippet: get-user.endpoint.ts -->
```typescript
import type { GetUserInput, User } from './api-operations.js';
import { GetUser as GetUserOperation } from './api-operations.js';
import { UserNotFound } from './errors.js';
import { observability } from './pipeline.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/**
 * `@Handler` marks a handler class; the method is always named `handle`.
 * Export it when a unit test should be able to `new` it directly.
 */
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(payload: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(payload.id);

    // The failure is returned, not thrown. For the response it is the same
    return user ?? UserNotFound({ id: payload.id });
  }
}

/**
 * The address, the schemas and `errors:` belong to the operation, which the
 * client imports too. Only execution is declared here.
 */
export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  handler: GetUserHandler,
});
```

The second parameter of `handle` is `meta`: it carries what the `.pre`
units of the layer put into the context, typed. The status of a success,
headers, cookies and a redirect are the HTTP shape of the response and
live in `references/http.md`.

## Forms of io

A schema describes one JSON value. Anything else is a form:

| Form | Handler returns | On the wire |
|---|---|---|
| `stream(T)` | `AsyncIterable<T>` | NDJSON |
| `events(T)` | `AsyncIterable<T>` | SSE |
| `multipart({ fields, files })` | a value | `multipart/form-data` on input |
| `upload({ maxSize, mime })` | a value | one file part, checked while parsed |

Forms are declared in `input:` or `output:` in place of a schema:
`output: stream(LogLine).limit(1000)`. A transport that cannot carry the
chosen form fails on ASSEMBLE, not on the first request.
