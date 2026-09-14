# 9. See every request in the log

> Guide to the current API; verified against `92353887`.
> Target description: [design/pipeline.md](../design/pipeline.md) and
> [design/container.md](../design/container.md), the "Kernel logger" section.
> Why: entries [ideas.md](../../decisions/ideas.md)
> `Pipeline v2: плоские фазы, слои, композиция константами`,
> `Асинхронный контекст: read-only ALS-проекция pipeline-контекста`,
> `[2026-09-06] Логгер ядра: RootLogger$, семейство Logger$ с.auto и child` and
> `[2026-09-12] Разбор обзоров d/10 и d/13`, point 2.

The service answers clients, but what happens to it is visible only through
the responses. Every request must leave a record in the log: the address,
the status and how it ended. The records of one request, even from deep
inside the code, must connect to each other by a shared identifier.

## The kernel logger

There is no need to declare your own logger: the kernel has one, and both
the framework and the application use it. The service takes it as an
ordinary dependency:

```typescript
// src/users/users.repository.ts
import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    // …
  ) {}

  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
```

`Logger` is an interface from `@nestlingjs/app`. `Logger$` is a DI token
family: `Logger$('db')` gives a logger with the `db` scope, and
`Logger$.auto` gives one with the scope named after the consumer class,
here `DbUsersRepository`. The scope reaches every record in the `scope`
field, so the log shows who wrote the line. The recipe
["Dependencies by name and contributions collected from
modules"](../recipes/token-families.md) tells how DI token families work.

Packages use the same logger: the database connection writes
`database connected` with the host, not the whole address — the address
carries the password.

The logger has four levels: `debug`, `info`, `warn`, `error`. Each has
three call forms:

| Form | What comes out |
|---|---|
| `logger.info('database connected', { host })` | a message and fields |
| `logger.error(error, { operation })` | a message from `error.message`, the error itself in the `err` field |
| `logger.debug({ rows: 3 })` | only fields, no message |

A failure from [chapter 4](./04-errors.md) passes as the error form:
`logger.warn(UserNotFound({ id }))`. The `err` key is reserved for the
error: the logger records its name, message, stack and `cause`.

`logger.child({ orderId })` returns a logger that adds `orderId` to every
record. This is how a series of records about one object is written.

Records leave for `stderr` one line each. Two environment variables set the
level and the format:

| Variable | Values | Default |
|---|---|---|
| `NESTLING_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` | `info` |
| `NESTLING_LOG_FORMAT` | `text`, `json` | `text` |

A record below the set level is dropped; `silent` cuts off all four
levels. A typo in the value stops the start: this is an ordinary config
section, and an invalid value is checked at build, as in
[chapter 7](./07-config.md).

## The observability layer

The pipeline — a sequence of steps — describes everything that happens
around the handler. A step is one function or class. The pipeline is
declared by a `makePipeline()` call and reads top to bottom as the order of
execution:

| Method | When it runs | What it sees |
|---|---|---|
| `.pre(step)` | before the handler, in declaration order | the accumulated context; each step adds its own fields to it |
| `.ok(step)` | only for a successful response | the full context |
| `.catch(step)` | only for a failure response | the fields of its own layer as optional |
| `.finally(step)` | always, last | the same as `.catch`, plus the outcome of the request |

The log needs two phases: `.pre`, to put the request and trace
identifiers into the context, and `.finally`, to record the outcome.

```typescript
// src/observability.ts
import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  Logger$,
  makePipeline,
  withRequestId,
  withTracing,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * A `.finally` step: writes an audit line when every request finishes.
 */
@Handler([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // The kernel puts the request identifier into the record: it is a
    // declared correlation field, and no prefix is written by hand
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

export const traced = makePipeline()
  .pre(withRequestId())
  .pre(withTracing())
  .finally(AuditOutcome);
```

`withRequestId()` is a ready pre-step from `@nestlingjs/app`. It takes the
identifier from the `x-request-id` header or generates a random one and
puts it into the context as the `requestId` field.

`AuditOutcome` is a `.finally` step in the form of a class. A class is
needed because the step needs the logger from the container: the
dependencies are declared in the role decorator. The role here is
`@Handler` — the class has a `handle` method; in the `providers:` of the
feature it stays an ordinary graph node. The `handle` method gets three
arguments.

- `outcome` — how the request ended: `completed`, `failed`,
  `disconnected` or `aborted`. `.finally` is called on any of them,
  including a dropped connection and an application stop, and an error
  inside `.finally` does not change the response.
- `res` — the final response. `res.status` does not depend on the
  transport: `ok`, `created`, `not_found`. The transport translates it into
  an HTTP code.
- `ctx` — the context of the request. `ctx.input` holds the fields
  accumulated by the pre-steps; `ctx.raw.pattern` is the pattern of the
  endpoint, for example `GET /users/:id`.

The type `ExtendableContext<{ requestId?: string }>` describes what the
step expects from the context: the field is declared optional, because
`.finally` also gets requests on which the pre-step did not manage to run.
A field outside the declared type does not compile.

The request identifier is in the audit record even though the step does
not pass it. `requestId` is a declared **correlation field**: the kernel
reads it from the context of the request and adds it as a field to every
record made inside the request. Outside a request, for example during a
resource acquisition, the field is absent. What else goes into records as
a field is set by the `logging` option of the root —
[below](#your-own-logger).

`traced` is a layer: one `makePipeline()` call with a chain of
methods, an ordinary value. It is exported and connected to every endpoint.

## Connecting to endpoints

```typescript
// src/users/endpoints/list-users.endpoint.ts
export const ListUsers = httpEndpoint.get('/users', {
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: traced,
  handler: ListUsersHandler,
});
```

The `pipeline:` field accepts a layer. An endpoint without this field works
too: `BuildInfo` from [chapter 10](./10-auth.md) has no pipeline, and
neither do the `makeHttpProbes()` probes from the recipe ["Who is connected
right now and how to disconnect them"](../recipes/ops.md).

The container creates the step class, so `AuditOutcome` is registered in
the `providers:` of the feature. A step class missing from `providers:`
stops the build on the BUILD phase, before the socket opens.

```typescript
// src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [DbUsersRepository, AuditOutcome, Authenticate],
  // …
});
```

Start the service and make a request:

```bash
API_TOKEN=secret NESTLING_LOG_LEVEL=debug \
  yarn start:dev
curl -H 'x-request-id: req-42' http://localhost:3000/users/1
```

Two records with one identifier appear in the log:

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository byId 1 requestId=req-42
2026-09-06T12:00:00.001Z INFO  AuditOutcome GET /users/:id ok requestId=req-42 outcome=completed
```

The store writes the first record, `AuditOutcome` writes the second.
Without the `x-request-id` header, a random UUID stands where `req-42` is.
Without `NESTLING_LOG_LEVEL=debug` there is no first record: the default
level is `info`. With `NESTLING_LOG_FORMAT=json` the same records come out
as objects with the `time`, `level`, `scope`, `requestId`, `msg` fields and
the fields of the call.

## The request identifier deep in the graph

`DbUsersRepository` writes the `byId 1` record. The handler does not pass
it `requestId` as a parameter: the store reads the value from the context
itself.

```typescript
// src/users/users.repository.ts
import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';

@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    // …
  }

  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
```

`RequestId` is the context variable that `withRequestId()` declares.
`Ctx(RequestId)` is the DI token of the reader of this variable, typed by
the value of the variable as `CtxReader<string>`. The reader is an
ordinary graph node: the dependency of the store on the context of the
request is visible in `deps` and in the visualization of the graph, and a
test replaces it through `contextValue`.

While a request runs, the accumulated context of the pipeline is available
to any code called from the handler, at any depth. The reader gives two
methods.

- `get()` returns the value or throws an error naming the reason, if there
  is no request or the variable is not declared in the pipeline.
- `peek()` returns the value or `undefined`. The store uses it because the
  same method can be called during a resource acquisition, where there is
  no request yet.

The store puts `requestId` into the record field itself, because it needs
the value: this is its own way of reading the context. A logger record
does not need this: the field that a call did not set, the kernel adds on
its own. This is how `AuditOutcome` above works. A call field is stronger
than a correlation field: an explicit value of the caller stays in the
record.

The `hasVar` build policy checks that the variable is declared on every
route where it is read: [chapter 10](./10-auth.md).

## Trace of the request

`withTracing()` is the second step of the layer. It puts the `Trace`
variable into the context, with a value of the shape
`{ traceId, spanId, parentSpanId?, sampled }`, and the kernel adds
`traceId` as a field to every record inside the request — the same way it
adds `requestId`: this is the second correlation field of the default.

```text
2026-09-12T20:03:49.400Z INFO  UsersService created requestId=7f3a… traceId=4bf92f35…
```

The step continues the trace of the caller, if it arrived in the
`traceparent` header, and starts a new one if it did not. A span
identifier is created for every request, and the span of the caller goes
into `parentSpanId`. A header that cannot be parsed does not break the
request: the trace starts over.

Inside one process the difference between `requestId` and `traceId` is
small. It becomes important when a request passes through several
services: `requestId` is its own at each one, and `traceId` is the same
for the whole chain. How the trace crosses a process boundary is shown in
[chapter 20](./20-split.md).

The value is also available to application code, through the
`Ctx(Trace)` reader, the same way as `RequestId`:

```typescript
@Component([Ctx(Trace)])
export class AuditTrail {
  constructor(private readonly trace: CtxReader<TraceContext>) {}

  record(action: string): void {
    this.store.put({ action, traceId: this.trace.get().traceId });
  }
}
```

A layer can be extended by another layer with the `compose` function: the
`pre` steps of the outer layer run earlier, and the `.finally` of the
outer layer runs later than that of the inner one.

## Your own logger

By default the kernel logger writes to `stderr` as text or JSON. Another
logging library connects through the `logger` field of the `logging`
dictionary. For pino a ready implementation lives in its own package:

```bash
npm install @nestlingjs/logging.pino pino
```

```typescript
// app.ts
import { pinoLogger } from '@nestlingjs/logging.pino';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: { logger: pinoLogger({ pino: { redact: ['password'] } }) },
});
```

`pinoLogger` takes `level`, `format` and the `pino` field — the rest of
the options of the library: redaction, serializers, sampling. In the
`text` format the line matches the standard logger byte for byte: one and
the same function prints it. In the `json` format the line is written by
pino itself — the same set of keys, its own order.

The keys the format rests on belong to the adapter: `level`, `timestamp`,
`formatters`, `base`, `messageKey`, `errorKey`, `transport` and the nested
`serializers.err`. An owned key that is passed in stops the creation of
the logger, and the message names the replacement. The adapter cannot
silently overwrite it: the format would stop being a promise.

Replacing the root changes every member of `Logger$`: both `Logger$.auto`
in the services and the records of the kernel itself, including build
warnings. The value is ready-made: the root logger is created before the
graph, so it cannot depend on its nodes — everything it needs is passed to
it. There is no second way to declare the root: a provider under
`RootLogger$` in `providers:` is a build error, and its text names the
`logging` option.

Someone else's implementation gets correlation fields for free: the kernel
mixes them in, not the logger. An implementation for another library is
written the same way as `pinoLogger`: the `Logger` interface lives in a
separate package, `@nestlingjs/logging` — an adapter needs the interface,
not the whole kernel. The line format is taken from there too,
`formatLine` and `serializeError`, so that it is not written a second
time:

```typescript
import type { Logger } from '@nestlingjs/logging';
import { formatLine, serializeError } from '@nestlingjs/logging';
```

A script next to the application — a document generator, a migration, an
external client — takes a ready logger from the same factory:

```typescript
// src/openapi.ts
import { makeConsoleLogger } from '@nestlingjs/app';

makeConsoleLogger().info('document written', { file, paths: 12 });
```

The line format is the same as the one the service writes, so the output
of the script reads with the same eye and the same grep.

## The set of correlation fields

A correlation field is a context variable whose value goes into every
record. The set is given by `logging.fields`:

```typescript
// app.ts
import { logField, makeApp, RequestId, Trace } from '@nestlingjs/app';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: {
    fields: [
      RequestId,
      logField(Trace, 'traceId', (trace) => trace.traceId),
      logField(TenantId, 'tenant'),
    ],
  },
});
```

The default is the first two lines of the list: `requestId` and `traceId`.
These are exactly the ones standing in the records of the examples above.

A variable without a wrapper gives a field with the name of the variable
and the value as a whole: `RequestId` is `requestId: '7f3a…'`. The
`logField(Var, name, select?)` wrapper sets the name of the field, and the
third argument sets what part of the value goes into it. A projection is
needed for variables that are objects: `Trace` carries `traceId`, `spanId`
and `sampled`, while the record needs the trace identifier — records of two
processes are searched by it.

An empty list, `fields: []`, turns correlation off: records come out
without fields from the context.

A plugin declares its own fields too, through the `logFields` field:

```typescript
export const tenancy = makePlugin({
  name: '@acme/tenancy',
  logFields: [logField(TenantId, 'tenant')],
  // …
});
```

This way an observability plugin puts its own field in itself, and the
application does not have to write about it. The lists of the root and of
the connected plugins are added up at build. Two declarations with one
field name stop the start: the message names the name and both declarers.

## Check

```typescript
// src/app.spec.ts
it('пишет запись аудита через логгер ядра', async () => {
  // The override of the root intercepts the records of every member of
  // Logger$: both the kernel and the application. The scope of the record
  // is the name of the class that took Logger$.auto
  const spy = spyLogger();
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await testApp.call(GetUser, { id: '1' }));

  expect(spy.entries).toContainEqual({
    level: 'info',
    message: 'GET /users/:id ok',
    fields: {
      scope: 'AuditOutcome',
      outcome: 'completed',
      requestId: expect.any(String),
    },
  });
});
```

`spyLogger()` from `@nestlingjs/testing` returns a logger that collects
records in `entries` instead of `stderr`. The override of `RootLogger$` in
the `overrides` of the test root intercepts the records of every member of
`Logger$` — both the services and the kernel — starting from the INIT
phase. The `testApp.call` call passes through the whole pipeline, so
`.finally` runs, and the audit record ends up in `spy.entries`. Each record
is `{ level, message, fields }`; the `scope` field carries the scope of the
family member, and `requestId` is a correlation field: the spy gets it the
same way the standard logger does.

Without the override the test run is silent: `buildTest` brings the
application up with `NESTLING_LOG_LEVEL=silent`, so the output of the test
is the report of the runner, not the build records of each of hundreds
of runs. Records in `stderr` are brought back by an own
`config: vars({ NESTLING_LOG_LEVEL: 'info' })`.

A request for a nonexistent user leaves a `GET /users/:id not_found`
record in the log with the `outcome=failed` field: a handler failure
passes through the same `.finally`.

```bash
curl http://localhost:3000/users/404
```

The layer that checks a DI token and does not let you forget it on a new
endpoint: [chapter 10](./10-auth.md).
