# Configuration from a file and without a restart

> Guide to the current API; verified against `02d6b233`.
> Target description: [design/config.md](../design/config.md), sections 2–8.
> Rationale: the entries [ideas.md](../../decisions/ideas.md)
> `Конфиг: keys-capability вместо configs:-владения` [2026-07-10],
> `Конфиг: secret() и общие ключи` [2026-07-13] and
> `Конфиг: derived, env({ prefix }), описания полей через конвертеры`
> [2026-09-06].

Some values in production come from somewhere other than the
environment: a file, Vault, an object with defaults for a local run.
One key, for example `DATABASE_URL`, is read by two sections. The
request limit needs to change on the fly, without restarting the
process.

Declaring a section, deriving keys, `secret()` and stopping the start
on an invalid config are described in chapter
[7](../guide/07-config.md). Here is only what comes on top of that.

## A source bound to a section's keys

```typescript
// src/main.ts
const app = makeApp({
  features: [AppFeature],
  plugins: [appCounters],
  providers: [Demo],
  config: [
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [objectSource({ RUNTIME_RPS: '50' }, 'runtime'), runtimeConfigKeys],
  ],
}).assemble();

await app.run();
await app.close();
```

The `config` field accepts a list of "source, target" pairs. A source
is an object with the `ConfigSource` interface: the required
`get(key)` method and the optional `name`, `init()`, `watch(notify)`
and `close()`. A target is a section's `.keys`, a glob of the form
`'*_URL'` or an array of them. In the example, `objectSource` serves
as the source, an object over a plain record. A file or Vault source
implements the same interface in a separate package; the kernel ships
no ready-made sources.

Reading rules:

- the order of the list sets the priority: the key comes from the
  first binding whose target covers the key and whose source returned
  something other than `undefined`;
- a target limits the source's scope: the `objectSource` from the
  first line is bound to the keys of the `app` section and is not
  queried for other sections. A target that covers no declared key
  gives a warning on start: this catches a typo in the glob;
- `process.env` is queried last and always; it is not added to the
  list. `DATABASE_URL` in the example is bound nowhere and is read
  from the environment;
- a key missing from every source reads as `undefined`, and the
  field's schema decides next: `.default()`, `.optional()` or a
  validation error.

An invalid config stops the start before the socket opens:
`ConfigValidationError` lists every error of the section and which
source each value was read from.

The same list is accepted by `bootstrapConfig()` when the container is
assembled without `makeApp`, through `ContainerBuilder`:

```typescript
// src/container.ts
export const makeContainer = async (
  runtime: ConfigSource = objectSource({}, 'runtime'),
): Promise<BuiltContainer> => {
  const config = await bootstrapConfig([
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [runtime, runtimeConfigKeys],
  ]);

  const builder = new ContainerBuilder()
    .register(configKernel(config))
    // The root logger lives outside the graph: `makeApp` creates it on
    // phase 0 and registers it as a value itself; here the calling
    // code does that
    .register(valueProvider(RootLogger$, makeKernelLogger(config)))
    // Kernel modules that `assemble` registers itself: the kernel
    // logger reads the `nestlingLog` section and the request id from
    // the context
    .register(contextKernel(), loggerKernel())
    // The example has no switch branches, so the value map is empty
    .register(...resolveBranches(appCounters.modules, {}))
    .register(AppModule);

  // Probes come after the modules: the kernel node names every
  // contribution by name. There is no phase here at all, so its
  // reader answers RUN, the same as in a test run
  registerHealth(builder, () => 'RUN');

  return builder.build();
};
```

`ContainerBuilder` assembles the same graph as `makeApp` in `main.ts`
of the same example, but without the application phases and without
transports. There are two phases here, and they are separated
explicitly: `bootstrapConfig` brings up the sources, the only
input-output here, and `build()` assembles the graph synchronously.
`configKernel(config)` connects the configuration kernel, and
`contextKernel()` and `loggerKernel()` connect the request context and
the kernel logger. When assembling through `makeApp`, the assembly
itself registers all three. The `appCounters` plugin registers through
its own modules. The `modules` list may hold switch branches, so
`resolveBranches(modules, values)` expands it: the example has no
branches, and the value map is empty. `registerHealth` connects the
probes: the `Health$` node is assembled even without `makeApp`, and
the calling code names its phase for it (the recipe [Who is connected
right now and how to disconnect them](./ops.md)).

## One `.env` file for several services

One environment file serves several services if each one reads its
values under its own prefix. The `env` source sets the prefix:

```typescript
config: [[env({ prefix: 'SERVICE_1_' }), '*']],
```

The source reads `SERVICE_1_<KEY>` and returns the value under the
name `KEY`. It gets its priority by the position of the binding, like
any other source, so `SERVICE_1_HTTP_PORT` overrides `HTTP_PORT`. A
key missing under the prefix is read by the implicit `process.env`
without the prefix: `DATABASE_URL` stays shared across every service.

Sections know nothing about the prefix. `.keys` lists `HTTP_PORT` and
`HTTP_HOST`, the registry snapshot names the same names, and the
binding's glob is also written without the prefix. The prefix lives in
the source, and only there.

## The right to bind, not the section

```typescript
// src/config/app.config.ts
export const AppConfig = makeConfig('app', {
  metricsPrefix: z.string().min(1).default('app'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

export const appConfigKeys = AppConfig.keys;
```

```typescript
// src/config/index.ts
export { appConfigKeys } from './app.config.js';
```

Two rights are tied to a section. The section's DI token gives the
right to read it: whoever imported `AppConfig` can name it in `deps`.
`AppConfig.keys` gives the right to bind a source to its keys and
nothing more: naming `.keys` in `deps` is a compilation error — the
binding right does not give the right to read. So only
`appConfigKeys` leaves the config folder outward, and the section's DI
token is imported by a direct path inside the application.

## A shared key between two sections

```typescript
// src/health/health.config.ts
export const HealthConfig = makeConfig('health', {
  databaseUrl: from(
    'DATABASE_URL',
    z.string().default('postgresql://localhost:5432/myapp'),
  ),
});
```

The second section declares reading the key without the first one's
knowledge. The rules for a shared key:

- each section checks the raw value with its own schema: `app`
  requires `z.url()`, `health` accepts `z.string()`; an error in
  either one stops the assembly with the name of that exact section;
- the key's secrecy is shared by every reader: `app` marked
  `DATABASE_URL` as `secret()`, so printing `HealthConfig` shows
  `'***'`, even though its declaration has no `secret()`;
- the only conflict between two readers is a different `reloadable`
  flag. Declare `HealthConfig` through `makeConfig.reloadable`, and
  the assembly fails with `ConfigSharedKeyError`, which names the key,
  both sections and both fixes.

`describeConfig()` shows who reads the key. The snapshot is built from
the declared sections and does not reach the sources:

```typescript
// src/config/secrets.spec.ts (fragment)
    const entry = describeConfig().keys.find(
      (item) => item.key === 'DATABASE_URL',
    );

    expect(entry?.secret).toBe(true);
    expect(entry?.readers.map((reader) => reader.section).sort()).toEqual([
      'app',
      'health',
    ]);
```

## Field descriptions in the snapshot

The snapshot gives the descriptions, defaults and enumerations of
fields if you pass it a schema converter — the same `zodConverter` from
`@nestlingjs/schema.zod` that the document generator from chapter
[13](../guide/13-openapi-and-client.md) substitutes by default. Here
there is no default: the list stays the caller's data, and without it
the snapshot is the same as before.

```typescript
import { zodConverter } from '@nestlingjs/schema.zod';

const snapshot = describeConfig({ converters: [zodConverter()] });

snapshot.sections[0].keys[0].schema;
// { outcome: 'converted', vendor: 'zod', json: { description: '…', default: 20 } }
```

The key's description carries the JSON Schema of its leaf and the
outcome of the conversion. There are three outcomes: `declared` means
the schema was declared by an annotation, `converted` means a
converter obtained it, and `unconvertible` means the list has no
converter for this vendor. The last one tells apart "there is no
converter for this vendor" from "the field has no description." The
description, default and enumeration sit as fields of the schema
itself: `description`, `default` and `enum`.

The sections of the framework packages themselves arrive with the
`converted` outcome: they are written in the same validator whose
converter was passed in the list.

This snapshot builds the table of variables for deployment
documentation. Whoever writes the documentation chooses the Markdown,
the columns and the row order: the framework hands over the data and
stops there. Without `converters`, the snapshot stays the same — it
has no `schema` field.

## Values without a restart

```typescript
// src/runtime/runtime.config.ts
export const RuntimeConfig = makeConfig.reloadable('runtime', {
  rps: z.coerce.number().int().positive().default(100),
});

export const runtimeConfigKeys = RuntimeConfig.keys;
```

`makeConfig.reloadable` declares a section whose values update in
place. The section object is never recreated: a reference obtained in
the constructor stays working, and reading a field returns the latest
valid value. A field named `onChange` is forbidden in such a section:
this name is taken by the subscription.

```typescript
// src/runtime/rate-limiter.ts
@Component([RuntimeConfig, Logger$.auto])
export class RateLimiter {
  /** The values of `rps` received through `onChange` */
  readonly history: number[] = [];

  constructor(
    private readonly config: Config<typeof RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  get limit(): number {
    return this.config.rps;
  }

  @OnStart()
  watch(signal: AbortSignal): void {
    this.config.onChange(signal, (next) => {
      this.history.push(next.rps);
      this.logger.info('rate limit changed', { rps: next.rps });
    });
  }
}
```

The consumer has two ways to see the new value. The first: read the
field on every access, as `limit` does. This needs no subscription.
The second: `onChange(signal, callback)`, for when a change in the
value needs a reaction, for example rebuilding a resource. The
subscription is dropped when `signal` fires. The `@OnStart` hook
receives it as an argument — the same stop channel that transports
receive, so there's no need to keep your own `AbortController`. A
value copied in the constructor will not update, so reloadable is
turned on for a section explicitly.

Updates come from a source with a `watch()` method. `objectSource` has
one: a `set(key, value)` call notifies the reader. Two differences
from the start:

- an invalid value at the start stops the application. An invalid
  update is dropped, the last valid snapshot remains, and the reader
  writes a warning with the `[nestling/config]` prefix;
- a reloadable section whose keys are covered only by sources without
  `watch()` starts up and warns at start: there will be no updates.

## A derived field on reload

A section's derived field is described in chapter
[7](../guide/07-config.md). A reloadable section gives it its own
behaviour: it recomputes when the value of at least one dependency
changes.

```typescript
const RuntimeConfig = makeConfig.reloadable(
  'runtime',
  { rps: z.coerce.number().int().positive().default(100) },
  (derived) => ({ perMinute: derived(['rps'], (rps) => rps * 60) }),
);
```

An update to `RUNTIME_RPS` gives a new `perMinute`, and `onChange`
subscribers receive the section with both new values. If the
dependency values matched the previous ones, the field's function is
not called at all. The comparison is shallow, by identity: a schema
that returns a new object on every check triggers a recompute every
time.

An error in the function on reload behaves like an invalid key value:
the whole section keeps the last valid snapshot, subscribers are not
called, and the reader writes a warning. At the start, the same error
stops the application — it is `ConfigDerivedError`, and it names the
section, the field and the list of dependencies.

## Checking

A test assembles the container with a source that it then changes:

```typescript
// src/runtime/reload.spec.ts
  it('отдаёт новое значение после обновления источника', async () => {
    source.set('RUNTIME_RPS', '20');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });

  it('оставляет последнее валидное значение при невалидном обновлении', async () => {
    source.set('RUNTIME_RPS', 'many');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });
```

The `onChange` subscription opens in `@OnStart`, so the test calls
`container.start()` after `init()`. The second test shows that an
invalid update reaches neither the read nor the subscription.

`config/secrets.spec.ts` checks the secrets and the shared key:
printing the `health` section equals `{"databaseUrl":"***"}`, and
reading the field returns the real address.

```bash
yarn start:dev
yarn test
```

Operational endpoints: who is connected to the service right now and
how to end a subscription — the recipe [Who is connected right now and
how to disconnect them](./ops.md).
