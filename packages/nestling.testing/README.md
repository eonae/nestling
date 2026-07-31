# @nestling/testing

The test composition root: it drives **the same** `App` through phases
`0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE` and stops there. `dispatch` is
born, sockets are not opened, `SIGTERM`/`SIGINT` handlers are not installed
and nothing is printed to stdout.

The package is thin by construction: testability here is a consequence of the
architecture, not of machinery in this package. There is no runner, no
matchers, no snapshot machinery — jest stays jest.

```typescript
import { assembleTest, unwrap, vars } from '@nestling/testing';

await using app = await assembleTest({
  features: [UsersFeature, LoggingFeature],
  transports: [http({ port: 0 })],
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  config: vars({ USERS_PAGE_SIZE: '10' }),
  // the same invariants as production: the test root does not weaken them
  policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase)],
});

expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({ id: '1', name: 'Alice' });
```

`assembleTest` is async, so the canonical form is `await using app = await
assembleTest(…)`: `await using` awaits the *dispose*, not the initializer.
The plain form (`const app = await assembleTest(…)` plus `await app.close()`
in `afterEach`) works too, and `close()` is idempotent.

## What the test run does and does not do

| Runs | Does not run |
|---|---|
| selection, registration, discovery, `build()` | `container.start()` (`@OnStart`) |
| every ASSEMBLE fail-fast: transports, io forms, cycles, `policies` | `transport.serve(...)` — no socket |
| `@OnInit` in topological order | `SIGTERM`/`SIGINT` handlers |
| WIRE: declarations resolve deps, `dispatch` per transport | the startup summary line |

A consequence worth stating out loud: **a resource acquired in `@OnStart` is
not acquired in an app test.** That is the price of the phase model, not a
defect — `@OnStart` is the go-live hook, and a test run never goes live.
Anything the test needs is acquired in `@OnInit`, which is where the phase
model puts resources anyway.

## `app.call` — a request through the full pipeline

```typescript
const res = await app.call(CreateUser, { name: 'Alice' });
// ResponseContext<User>: { isSuccess: true, status, value }
//                      | { isSuccess: false, status, value: { error, code, … } }
```

This is what separates an app test from a unit test: every pipeline layer,
schema validation and the boundary guard actually run. The declaration is
looked up **by value identity** — the test holds the same value the module
lists in `endpoints:`, so no string matching is involved; a declaration that
is not part of the application (module not registered, feature left out by
`select`) throws an error listing the available handles.

- `input` is typed by the declaration's `input` form, the result by its
  `output` form; the failure branch carries the `status` and the `code` from
  the closed `errors:` contract.
- `unwrap(res)` returns the value or throws with the status and the code —
  for the common "I expect success" case.
- The request frame is honest but empty: `raw.transport` and `raw.pattern`
  come from the declaration, `raw.attributes` is `{}` unless the test passes
  `options.attributes`. A layer that reads HTTP headers sees nothing — that
  is the price of an in-proc call.
- Transport binding is **not** performed: `call` takes a ready payload.
  Assembling one from path/query/body is what e2e and bind-map unit tests are
  for.
- `exposeErrorDetails` defaults to `true` — in tests you want the details.

## `overrides` — substitution in the graph

```typescript
overrides: [
  [UsersRepository, inMemoryUsersRepo()],      // token -> fake
  familyOverride(ILogger, () => noopLogger),   // the whole family recipe
]
```

Substitution happens on ASSEMBLE, before instantiation — this is not
patching and not module-system interception. The key exists on the test root
only; `assemble` does not accept it.

- the pair is typed: a fake that does not match the token's type is a
  compile error;
- overriding a token that is not in the graph fails the build — rename a
  provider and the test breaks instead of silently mocking nothing;
- overriding the same token twice fails the build;
- there is no string-addressed form (`overrideByName('…')`): you can only
  override a token you hold a reference to.

**Pruning** drops the subtree orphaned by the substitution: mock the
repository and the pg pool is never instantiated, never connects, and is not
in the graph. `app.pruned` lists the ids that dropped out, and `app.get(token)`
returns `null` for them. Without `overrides` pruning is the identity — the
graph is exactly the production one.

## `.check()` — mock something, check the topology

Pruning makes the test graph smaller than the production one. The
compensation is `App.check()` (in [`@nestling/app`](../nestling.app)): phases
0–1 on the **honest** graph, no substitutions. This package only wraps it
into a matrix:

```typescript
await checkTopologies(
  { features: [UsersFeature, LoggingFeature], transports: [http({ port: 0 })] },
  ['all', 'users', 'logging'],
);
```

The kernel fails fast; the helper tells the whole story — it collects **all**
failures and throws one message naming each topology with its cause.

A `spec` carrying `policies:` gets them checked in **every** topology of the
matrix, so an invariant that holds under `select: 'all'` but breaks on a
subset is caught in CI. The `detached` reasons travel as values in the
report, so a test compares the set of opted-out handles instead of parsing
stdout:

```typescript
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints.filter(({ detached }) => detached !== undefined)
    .map(({ pattern }) => pattern),
).toEqual(['GET /health']);
```

## `vars()` — config as an object

`vars(record)` is a named object `ConfigSource` with `watch`/`set`/`assign`.
`process.env` is not touched, so tests are isolated and parallelizable for
free, and reload machinery becomes testable:

```typescript
const src = vars({ RUNTIME_LOG_LEVEL: 'info' });
await using app = await assembleTest({ …, config: src });

src.set('RUNTIME_LOG_LEVEL', 'debug'); // reloadable section is re-projected
```

The `config:` field of the test root takes three shapes: a source (sugar for
`[[source, '*']]`), one binding, or a list of bindings. Production `assemble`
gets no sugar — there a binding is an act with priorities.

## `testModule` — one module in isolation

```typescript
await using app = await testModule(ReportsModule, {
  stubs: [[ILogger, noopLogger], [IClock, { now: () => 42 }]],
  transports: [http({ port: 0 })],
});
```

A mini-application around a single module (with its `imports`), the config
kernel module and the listed stubs; the same phases 0–3 and the same
`TestApp`. Every unsatisfied import has to be stubbed explicitly — the error
lists **all** missing tokens with the consumer of each, not the first one it
hits. `stubs` are "supply what is missing" rather than "replace what is
there", and the shape is the one `stub(Contract, impl)` will slot into.

## Repository wiring for the `"testing"` condition

The seam this package builds on lives at `@nestling/app/testing`, a
conditional subpath. The runner has to enable the condition:

```javascript
// jest
testEnvironmentOptions: { customExportConditions: ['testing', 'node', 'node-addons'] }

// vitest
resolve: { conditions: ['testing', 'node'] }
```

A package that imports such a subpath at build time also needs
`customConditions: ['testing']` in its `tsconfig.json`, and
`lib: ['es2022', 'dom', 'dom.iterable', 'esnext.disposable']` for
`await using`.

## Not here yet

`stub(Contract, impl)` and `app.emit(Event, payload)` need contracts
(`makeContract`), which V1 does not have yet. Until then `stubs:` accepts
plain `[token, value]` pairs.

## Exports

- `assembleTest(spec)` → `TestApp`; `testModule(module, options)` → `TestApp`
- `TestApp`: `call`, `get`, `pruned`, `features`, `close`, `Symbol.asyncDispose`
- `unwrap(response)`, `UnwrapFailedError`
- `vars(record)`, `familyOverride(family, make)`
- `checkTopologies(spec, selections)`
