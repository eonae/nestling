# 1. Bring up a service that answers a request

> Guide to the current API; verified against `da754bb4`.
> Target description: [design/composition.md](../design/composition.md),
> [design/endpoints.md](../design/endpoints.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-09-02] Модель композиции: фича, плагин, операция`,
> `[2026-09-03] Декларация приложения: makeApp, assemble(select), AssembledApp`
> and
> `[2026-09-06] Переключатели состава: makeSwitch, pick и when, аргумент сборки; формы корня без фич`.

Start with an HTTP service that answers `GET /users` with JSON. It starts with
one command and stops on `SIGTERM` without dropping requests that are already
being handled. It fits in one file.

```typescript
// src/main.ts
import { makeApp } from '@nestlingjs/app';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const User = z.object({ id: z.string(), name: z.string() });

const ListUsers = httpEndpoint.get('/users', {
  output: z.array(User),
  handler: async () => [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ],
});

const app = makeApp({
  endpoints: [ListUsers],
  transports: [http()],
});

await app.assemble().run();
```

The application consists of two values plus the assembly.

The `ListUsers` endpoint declaration describes the address, the response schema
and the handler. The method is named by the constructor name, the path is the
first argument, and together they give the pattern `GET /users`. The `output`
schema sets the shape of the response and, with it, the type of the return
value: a handler that returns an object of another shape does not compile. The
handler itself returns a plain array, and the transport serializes it to JSON.

The path is checked the moment the declaration is created. An empty path, a
path without a leading `/`, a repeated path parameter: each is an error on
importing the file, not on starting the application.

`makeApp` declares the application: the list of endpoints and the list of
transports. `http()` declares the HTTP transport. It takes the port and the
host from its own configuration section: `3000` and `0.0.0.0` by default. A
declaration is a value: it reads nothing and starts nothing. It is checked at
creation too, the shape of the composition and the list of fields, so a typo in
the field name fails on import, not on start.

The endpoints stand right at the root: a service with one route does not need a
named unit. How an application splits into parts once it has more than one area
is shown by [2. What an application consists of](./02-composition.md).

`app.assemble()` assembles the application for this process, `run()` builds the
graph, checks it, opens the socket and installs the `SIGTERM` and `SIGINT`
handlers. The order here is a guarantee: the socket opens after the graph is
assembled and checked, and the transport cannot accept a request before the
routing table is ready, since it has no start method without one. On the
signal, the transport stops accepting new requests, tells the current ones
about the cancellation and closes once they finish.

## How this lays out in the example

In the final example every value lives in its own file.

```typescript
// src/users/endpoints/list-users.endpoint.ts
export const ListUsers = httpEndpoint.get('/users', {
  output: z.array(User),
  handler: ListUsersHandler,
});
```

Here the handler is a class, not a function: the `handler` field accepts both
shapes.

The final example is already laid out by features: it has two areas, and a
named unit lists the endpoints.

```typescript
// src/users.feature.ts (fragment)
export const UsersFeature = makeFeature({
  name: 'users',
  endpoints: [ListUsers /* … */],
  // …
});
```

The `app.ts` file declares the application and exports one value, `app`:

```typescript
// src/app.ts (fragment)
export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  // …
});
```

The `main.ts` file imports `app` and runs it. There is nothing else in it: no
wrapper function, no error handler, no address printing. `run()` installs the
signal handlers, and a failed start crashes the process on its own.

```typescript
// src/main.ts
import { app } from './app.js';

await app.assemble().run();
```

The split into two files exists because more than the entry point reads the
declaration: the tests and the topology check read it too. The file naming
rules are collected in [conventions.md](../conventions.md).

## Start

```bash
API_TOKEN=secret yarn start:dev
```

The final example needs the `API_TOKEN` variable: one of its configuration
sections declares it required, and the application does not start without it.
For now, set it to any string.

On start, the application prints the composition of the assembly:

```
[nestling] features: users; transports: http
```

The service in this chapter declares no features, so its line is shorter:
`features: (none); transports: http`.

Check the response:

```bash
curl localhost:3000/users
# [{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]
```

The service answers a request with no parameters. Next, one scheme for
everything an application consists of:
[2. What an application consists of](./02-composition.md).

