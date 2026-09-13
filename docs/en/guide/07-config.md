# 7. The port and the database address from the environment

> Guide to the current API; verified against `771744f7`.
> Target description: [design/config.md](../design/config.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-08] Kernel/user space; конфиг как token-families; плагины`,
> `[2026-07-13] Конфиг: secret() и общие ключи` and
> `[2026-09-06] Конфиг: derived, env({ prefix }), описания полей через конвертеры`.

The port, the database address and the API Bearer token must come from
environment variables. Secrets must not end up in the logs. If a required
variable is missing, the application must crash at start, not answer `500` on
the first request.

```typescript
// src/app.config.ts
import { from, makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .describe('Размер страницы списка пользователей'),
  apiToken: secret(
    from(
      'API_TOKEN',
      z.string().min(1).describe('Bearer-токен для запросов, меняющих данные'),
    ),
  ),
});
```

There is no database address here, and this is not an omission. The
`@nestlingjs/drizzle.pg` package declares the connection section, and the
application gets from it only the right to bind a source to its keys. The port
and the host of the HTTP server work the same way: the server reads them, not
the application.

A section is an object with a prefix, where every field has a matching schema.
The name of the variable is derived from the prefix and the name of the field,
and `from('NAME', schema)` sets the exact name.

The description of a field is written with the tools of the schema:
`.describe()` in zod. The framework does not read it — it is for the person who
opened the file, and for whoever moves the table of variables into the
deployment documentation.

| Variable | Field | What it sets | Default |
|---|---|---|---|
| `APP_PAGE_SIZE` | `pageSize` | the page size of the user list | `20` |
| `DATABASE_URL` | the connection section | the database address | none, the variable is required |
| `DATABASE_POOL_MAX` | the connection section | the size of the connection pool | `10` |
| `API_TOKEN` | `apiToken` | the Bearer token for requests that change data | none, the variable is required |
| `HTTP_PORT` | the server section | the port of the HTTP server | `3000` |
| `HTTP_HOST` | the server section | the listening address | `0.0.0.0` |

Environment values arrive as strings. The schema turns a string into a number,
so `pageSize` has `z.coerce.number()`.

## A derived field

The third argument of `makeConfig` declares fields whose values are computed
from other fields of the same section. This is how the connection section in
`@nestlingjs/drizzle.pg` works: the host is computed from the address, so there
is no need to parse the URL in every consumer.

```typescript
// packages/nestling.drizzle.pg/src/config.ts
export const DatabaseConfig = makeConfig.family(
  'database',
  {
    url: secret(str()),
    poolMax: int(10, 1),
    // …
  },
  (derived) => ({
    host: derived(['url'], (url) => new URL(String(url)).host),
  }),
);
```

`derived(deps, fn)` names the dependencies by the field names of the first
record, and `fn` gets their values in order. The compiler checks both the names
and the types: `'urll'` does not build, and neither does the annotation
`(url: number)`. The field has no environment variable: it is not in the table
above, and it is not part of the section's `.keys`. The value is computed once,
when the section is validated.

`url` is marked `secret()`, so `host` is secret too: a field inherits the
secrecy of its dependencies. The rule is one-directional and deliberately
coarse — there is nothing that removes the mark.

It is `makeConfig.family` instead of `makeConfig` because there may be several
connections in a process, and each has its own address. The name of the
instance is inserted into the keys: `DATABASE_ANALYTICS_URL` for the
`analytics` instance. The second HTTP server gets its keys the same way.

## A section as a dependency

```typescript
// src/users/endpoints/list-users.endpoint.ts
@Handler([UsersRepository$, AppConfig])
export class ListUsersHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  async handle(input: ListUsersInput): Output<User[]> {
    const rows = await this.users.all();

    return rows.slice(0, input.limit ?? this.config.pageSize);
  }
}

export const ListUsers = httpEndpoint.get('/users', {
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: ListUsersHandler,
});
```

A section is injected as an ordinary dependency: the `AppConfig` DI token in
the role decorator's list. There is no need to register it in `providers`: the
node of the graph is created by the mere fact of being mentioned.
`Config<typeof AppConfig>` gives the type of the value: the `config.pageSize`
field has type `number`.

Any other consumer reads a section the same way — a component, a resource or a
factory: the section's DI token stands in the list of dependencies, and the
container supplies the checked value.

```bash
API_TOKEN=secret APP_PAGE_SIZE=1 yarn start:dev
curl 'localhost:3000/users'
```

## Secrets

`secret()` marks a field whose value must not end up in the output. Nothing
changes for the consumer: `config.apiToken` returns the real string. What
changes is what the framework prints. `console.log` and `JSON.stringify` of the
section show `'***'` instead of the value, and a validation error replaces the
validator's message with `<redacted>`.

The consumer is responsible for its own strings: the connection writes only the
host to the connection log, not the whole address. The host inherited the
secrecy of the address, so printing the section shows `'***'` in its place.
Writing it to the log is the consumer's own deliberate decision. A secret field
is not printed by the framework, neither in reports nor in errors — the
framework does not control the strings the consumer writes itself.

## Required values

`apiToken` has no default. Run the application without `API_TOKEN`:

```
failed to start: ConfigValidationError: Config section 'app' is invalid:
  - API_TOKEN (field 'apiToken'): Invalid input: expected string, received undefined
Sources consulted, in priority order: process.env
```

```bash
yarn start:dev   # without API_TOKEN: error at start
```

The section is checked when the graph is assembled, before the instances are
created and before the socket is opened. All the failed fields of a section are
collected into one error. A value that is not set is not hidden in the error
text: "the key is not set" is exactly what you need to see. Only the kernel
reads `process.env`: the section describes exactly what is read, and the
consumer gets a typed object.

It is not the transport but the server that reads the port and the host — the
node that holds the socket. It has its own keys: `HTTP_PORT` and `HTTP_HOST`,
`3000` and `0.0.0.0` by default. `http()` has no address option at all: the
address changes without rebuilding the image, so it is set only by a variable.
A second server gets its own keys by name: `server({ name: 'admin' })`
reads `HTTP_ADMIN_PORT` and `HTTP_ADMIN_HOST`. A test assembly needs no port at
all: it does not open a socket.

```bash
API_TOKEN=secret HTTP_PORT=8080 yarn start:dev
curl localhost:8080/users
```

The service works, and it is time to lock this in with tests that do not bring
up a socket. Next chapter:
[8. Make sure it works without starting a server](./08-testing.md).

