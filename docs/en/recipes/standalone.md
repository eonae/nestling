# Without `makeApp`

> Guide to the current API; verified against `8dfc73b4` and `container` (2026-09-06).
> Target description: [design/transports.md](../design/transports.md) §1,
> [design/composition.md](../design/composition.md) §1,
> [design/container.md](../design/container.md). Rationale: the entries
> [ideas.md](../../decisions/ideas.md)
> `Жизненный цикл: фазы, @OnStart, гарантия dispatch` and
> `Token families + модули без рантайм-инкапсуляции`.

The whole application is not needed. A few endpoints need to be
embedded into an existing process or script, or a dependency graph
needs to be built with no transport, for example to export it for
visualization. Both cases are solved by the same primitives the
application build is built from.

## An HTTP server from a server, a transport and `dispatch`

```typescript
// src/main.ts
const PORT = Number(process.env.PORT) || 3000;

const server = new HttpServer({ port: PORT, host: '0.0.0.0' });
const transport = new HttpTransport(server);

// The declarations have no `deps`, so `makeDispatch` accepts them as is
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

// The shared stop signal: once it fires, the transport accepts no new
// requests
const shutdown = new AbortController();

transport
  .serve(dispatch, shutdown.signal)
  // The same order as the START phase: the handler is attached, and
  // only then does the socket open
  .then(() => server.listen())
  .then(() => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

// Stopping runs the same steps in reverse: the signal, the server
// draining connections, the transport canceling requests in flight
const stop = async (signal: string): Promise<void> => {
  console.log(`${signal} received, shutting down`);
  shutdown.abort();
  await server.drain();
  await transport.close();
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
```

The steps the build performs in the WIRE and START phases are
written here by hand. `makeDispatch` builds the "pattern, handler"
table from the declarations, accepting only executable declarations —
with no unresolved dependencies in the handler class or the pipeline's
step classes: a declaration with dependencies fails the type check, and
the call does not compile. Two declarations of the same transport with
the same pattern stop `makeDispatch` with an error.

The server holds the socket, not the transport. The transport attaches
its handler to it in `serve(dispatch, signal)`, and only then does
`listen()` open the socket: this way a request cannot arrive before the
routing table is built. Under `makeApp`, the START phase gives the same
order. The root wires the stop on a process signal itself: `drain()`
finishes reading open connections, `close()` cancels requests in
flight.

Declarations with dependencies first receive them through
`endpoint.resolve(...)`; in an built application, the container
does this. Reading `process.env` in the root is allowed here: there is
no config section without the configuration kernel.

## An endpoint with no pipeline and an endpoint with a pre-step

```typescript
// src/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint.post('/users', {
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  handler: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, typeof EmailTaken> => {
    if (taken.has(input.email)) {
      return EmailTaken({ email: input.email });
    }

    return { id: Math.floor(Math.random() * 1000), ...input };
  },
});
```

The `pipeline` field is optional. A declaration without it is executed
by the same runtime with an empty pipeline: the input is checked by the
schema, the response is checked against the `errors:` list, and the
request context is open.

```typescript
// src/common/steps.ts
export const withStartedAt: PreStepFn<
  EmptyInput,
  { startedAt: number }
> = () => ({ startedAt: Date.now() });
```

```typescript
// src/endpoints/say-hello.endpoint.ts
export const SayHello = httpEndpoint.get('/', {
  output: SayHelloOutput,
  pipeline: makePipeline().pre(withStartedAt),
  handler: async (_payload, meta) => ({
    message: 'Hello from Nestling',
    startedAt: new Date(meta.startedAt).toISOString(),
  }),
});
```

A pre-step returns an addition to the context. The handler reads it
from the second argument, `meta`, together with `signal` and `fail`;
the type of the `startedAt` field is inferred from the step.

```bash
yarn start:dev
curl localhost:3000/
curl -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Alice","email":"taken@example.com"}'
curl -N localhost:3000/logs/export
```

The first request answers
`{"message":"Hello from Nestling","startedAt":"…"}`. The second returns
409 with the code `conflict:email_taken`. The third gives back NDJSON
from the `stream(T)` form.

## A container without an application

```typescript
// src/container.ts
export const makeContainer = async (
  runtime: ConfigSource = { name: 'runtime', get: () => undefined },
): Promise<BuiltContainer> => {
  const defaults: ConfigSource = {
    name: 'defaults',
    get: (key) => ({ APP_METRICS_PREFIX: 'demo' } as Record<string, string>)[key],
  };
  const config = await bootstrapConfig([
    bind(defaults, { keys: appConfigKeys }),
    bind(runtime, { keys: runtimeConfigKeys }),
  ]);

  const builder = new ContainerBuilder()
    .register(configKernel(config))
    // The root logger lives outside the graph: `makeApp` creates it on
    // phase 0 and registers it as a value itself; here the calling
    // code does that
    .register(valueProvider(RootLogger$, makeKernelLogger(config)))
    // Kernel modules that `build` registers itself: the kernel
    // logger reads the `nestlingLog` section and the request id from
    // the context
    .register(contextKernel(), loggerKernel())
    // The example has no switch branches, so the value map is empty
    .register(...resolveBranches(counters.modules, {}))
    .register(AppModule);

  // Probes come after the modules: the kernel node names every
  // contribution by name. There is no phase here at all, so its
  // reader answers RUN, the same as in a test run
  registerHealth(builder, () => 'RUN');

  return builder.build();
};
```

`ContainerBuilder` builds the same graph as `makeApp` in `main.ts`
of the same example, but without the application phases and the
transports. The configuration kernel, which the build through
`makeApp` registers itself, connects here in two steps:
`bootstrapConfig` brings up the sources by the bindings to the
sections' keys (as in the recipe [Configuration from a file and
without a restart](./config-sources.md)), and `configKernel` brings the
ready reader into the graph. The root logger lives outside the graph:
`makeApp` creates it on phase 0 itself, and without `App` the calling
code creates it — `makeKernelLogger(config)` — and registers it as a
value under `RootLogger$`. The kernel modules `contextKernel()` and
`loggerKernel()` are also registered by hand. The `counters` plugin
registers through its own modules. The `modules` list may hold switch
branches, so `resolveBranches(modules, values)` expands it: the
example has no branches, and the value map is empty. `registerHealth`
connects the probes: the `Health$` node is built even without
`makeApp`, and the calling code names its phase for it (the recipe [Who
is connected right now and how to disconnect them](./ops.md)).
`build()` is synchronous: it builds the graph and checks it as a
whole — a missing dependency and a cycle stop the build with one
error listing the nodes. It creates no instances: `init()` creates
them.

```typescript
// src/runtime/reload.spec.ts (fragment)
    container = await makeContainer(source);
    await container.init();
    shutdown = new AbortController();
    // The `onChange` subscription opens in `@OnStart` and is dropped
    // by the signal
    await container.start(shutdown.signal);
    limiter = container.getOrThrow(RateLimiter);
    // …
    shutdown.abort();
    await container.destroy();
```

The phases are called explicitly: `init()` creates the instances and
acquires the resources in topological order, `start(signal)` runs
`@OnStart`, `destroy()` calls `release` on the resources in reverse
order. Before `init()` finishes, the container gives out no instances:
`getOrThrow(token)` throws a phase error.

```typescript
// src/cli.ts
export const main = async () => {
  const container = await makeContainer();

  const metadata = await container.toJSON();
  const json = JSON.stringify(metadata, null, 2);

  await writeFile('di-metadata.json', json);
};

main().catch(console.error);
```

`toJSON()` gives back the graph with its nodes, edges and module
membership. The script writes it to a file, and `@nestlingjs/viz` draws
it in the browser. No transport is needed for this, so the script
builds a container, not an application.

## Checking

```typescript
// src/dispatch.spec.ts
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

/** Calls an endpoint with a ready payload, bypassing HTTP request parsing */
const call = (endpoint: ExecutableDeclaration, payload?: unknown) => {
  const raw: Raw = {
    transport: 'http',
    pattern: endpoint.pattern,
    payload,
    attributes: {},
  };

  const meta: EndpointMeta = {
    transport: 'http',
    pattern: endpoint.pattern,
    input: endpoint.input,
    output: endpoint.output,
    errors: endpoint.errors,
  };

  return dispatch.call(endpoint.pattern, makeEmptyContext(raw, meta));
};

  it('отдаёт значение pre-шага хендлеру', async () => {
    const response = await call(SayHello);

    expect(response.isSuccess).toBe(true);
    expect(response.value).toMatchObject({ message: 'Hello from Nestling' });
  });
```

Without `buildTest`, the test itself builds the request frame:
`makeEmptyContext` builds the initial context from the request
description and the declaration, and `dispatch.call` executes the
endpoint the same way the transport does. The rest of the file's tests
check a schema failure, a declared failure and a streaming response.

```bash
yarn test
yarn export-metadata && yarn visualize
```

The recipe [Extend the kernel with your own package](./extending.md)
shows how a separate package is written on top of the same public
primitives.
