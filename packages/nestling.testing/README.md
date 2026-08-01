# @nestling/testing

> 🚧 Active development, API may change. Design:
> [`docs/design/testing.md`](../../docs/design/testing.md).
> Guide: [`docs/guides/testing.md`](../../docs/guides/testing.md).

The test composition root: it drives **the same** `App` through phases
`0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE` and stops there. `dispatch` is
born, sockets are not opened, `SIGTERM`/`SIGINT` handlers are not installed
and nothing is printed to stdout.

The package is thin by construction: testability here is a consequence of the
architecture, not of machinery in this package. There is no runner, no
matchers, no snapshot machinery — jest stays jest.

```typescript
import { assembleTest, stub, unwrap, vars } from '@nestling/testing';

await using app = await assembleTest({
  features: [UsersFeature, OpsFeature],
  transports: [http({ port: 0 })],
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // a fake invoker for a contract this assembly does not implement
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
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
| `app.call` / `app.emit` through the full pipeline | the wire: transport binding, headers, sockets |

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
  contextValue(RequestId, 'req-1'),            // an ambient request variable
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
  override a token you hold a reference to;
- `contextValue(variable, value)` is sugar over `valueProvider(Ctx(variable),
  reader)` — the reader of an ambient variable
  ([`@nestling/pipeline`](../nestling.pipeline)) is an ordinary graph node, so
  it is substituted like any other. The fixed value is readable **without a
  request** (call the service directly; no ALS needed) and outranks the family
  recipe: on `app.call` the service reads what the test declared, not what the
  pipeline wrote. Leave it out and you get the production projection —
  the layer's value inside the call, `undefined` from `peek()` outside it.

**Pruning** drops the subtree orphaned by the substitution: mock the
repository and the pg pool is never instantiated, never connects, and is not
in the graph. `app.pruned` lists the ids that dropped out, and `app.get(token)`
returns `null` for them. Without `overrides` pruning is the identity — the
graph is exactly the production one.

## `stub(Contract, impl)` — a feature without its neighbours

A feature injecting `ChargeCard.port` does not even assemble without the
neighbour: the invoker recipe fails the reachability check. `stub` returns the
pair "invoker token -> fake" (`[C.port, …]` for a `request` contract,
`[C.emitter, …]` for `command`/`event`), and the pair travels in `stubs:`
alongside plain `[token, value]` ones — there is no separate field for it.

```typescript
stubs: [
  stub(ClaimQuota, async ({ amount }) => ({ granted: amount })),  // Port<C>
  stub(OrderPlaced, (fact) => void seen.push(fact)),              // Emitter<C>
]
```

The mechanism is an existing property of the container rather than an
exception carved out for tests: an explicit provider for a family member
**outranks** the recipe, so the production `buildPort`/`buildEmitter` is never
called for a stubbed contract — and neither is its reachability check.

**The fake is validated by the schemas of its own contract on every call** —
that is the whole point of it:

- the input is parsed by the contract's `input` form: an invalid payload is a
  `VALIDATION_FAILED` and `impl` is not called;
- a successful result is parsed by the `output` form, so a fake that drifted
  from the contract fails on itself instead of on its consumer. This is
  deliberately stricter than the production co-located port: a real reply has
  already been through the implementation's pipeline, a stub has none;
- a returned or thrown failure has to be in the contract's `errors:` (plus the
  kernel codes `VALIDATION_FAILED`, `UNKNOWN`, `DEADLINE_EXCEEDED`). An
  undeclared code is a defect of the test, so the stub **throws**, naming the
  contract, the code and the allowed set, instead of quietly turning it into
  an `UnknownError`;
- a non-`Fail` exception from `impl` propagates as is: "the fake blew up" must
  not read as "the neighbour answered UNKNOWN".

The operational profile is reproduced too: an exhausted `meta.deadline` yields
`DEADLINE_EXCEEDED` **before** `impl` runs, and `emit` of a `command` always
carries an `idempotencyKey` — the caller's or one minted by the stub.

The call site is identical to the production one (`Port<C>` / `Emitter<C>`,
result `PortResult<C>`), and a fake that does not fit the contract is a
compile error at `stub(...)`. There is no spy of our own: `impl` is a plain
function, so `jest.fn()` works there with zero lines of support here.

## `app.emit` — driving the app from the outside

```typescript
const [{ subscriber, response }] = await app.emit(PlaceOrder, { orderId: 'o-1' });
```

`emit` delivers a fact or a command to **every** co-located subscriber, each
through its own full pipeline, and returns their answers with the name of
each. It returns them rather than `void` on purpose: a publisher is not
responsible for the handling, a test is — and awaiting is safe here, since
there is no socket and the subscribers are co-located.

- transport attributes carry the call profile, `idempotencyKey` included;
- zero subscribers on an `event` is a legal broadcast and an empty list; on a
  `command` it is an addressing error listing the available subjects;
- a `request` contract is a compile error — it has one owner, not subscribers;
- a stubbed emitter does not get in the way: the stub replaces what the app
  calls **outwards**, `emit` drives it from the outside in.

## `.check()` — mock something, check the topology

Pruning makes the test graph smaller than the production one. The
compensation is `App.check()` (in [`@nestling/app`](../nestling.app)): phases
0–1 on the **honest** graph, no substitutions. This package only wraps it
into a matrix:

```typescript
await checkTopologies(
  { features: [UsersFeature, OpsFeature], transports: [http({ port: 0 })] },
  ['all', 'users', 'ops'],
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

### Contract compatibility, out of the same matrix

Every topology report carries `contracts` — descriptors of the contracts that
topology **publishes** — so the compatibility check needs no second assembly
and no second import:

```typescript
import {
  checkTopologies, diffContracts, formatCompatibility, snapshotContracts,
} from '@nestling/testing';

const reports = await checkTopologies(spec, ['all', 'users', 'ops'], {
  converters: [zodConverter()],
});

const report = diffContracts(readBaseline(), snapshotContracts(reports));

console.log(formatCompatibility(report));
expect(report.breaking).toEqual([]);
```

`checkTopologies(spec, selections, options?)` forwards `options` into every
topology's `check()`; the two-argument call behaves exactly as before.
Without converters the descriptors are still built — the structural part
(kind, io forms, failure codes and statuses) is exact — and leaf schemas are
honestly marked opaque, which yields the `unknown` verdict.

The failing line here is the test's own `expect`: `diffContracts` is a pure
function of two values, takes no part in assembly and never throws on a
comparison result. Verdict rules and baseline maintenance live in
[`@nestling/ports`](../nestling.ports).

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
  stubs: [
    [ILogger, noopLogger],
    [IClock, { now: () => 42 }],
    stub(ChargeCard, async () => ({ chargeId: 'c1' })),
  ],
  transports: [http({ port: 0 })],
});
```

A mini-application around a single module (with its `imports`), the config
kernel module and the listed stubs; the same phases 0–3 and the same
`TestApp`. Every unsatisfied import has to be stubbed explicitly — the error
lists **all** missing tokens with the consumer of each, not the first one it
hits. `stubs` are "supply what is missing" rather than "replace what is
there", and the field is the same one `stub(Contract, impl)` slots into — a
cross-feature call declared by the module is supplied like any other gap.

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

## Not here

`app.port(Contract)` — a typed port for testing a consumer — is an open
question of the design journal: the consumer side is covered by a stub, so
there is nothing to reach for yet. `.check()` takes no substitutions and never
will: it exists to run the honest graph that pruning and stubs are compensated
against.

## Exports

- `assembleTest(spec)` → `TestApp`; `testModule(module, options)` → `TestApp`
- `TestApp`: `call`, `emit`, `get`, `pruned`, `stubbed`, `features`, `close`,
  `Symbol.asyncDispose`
- `stub(contract, impl)` → the `[invoker token, fake]` pair for `stubs:`
- `unwrap(response)`, `UnwrapFailedError`
- `vars(record)`, `familyOverride(family, make)`, `contextValue(variable, value)`
- `checkTopologies(spec, selections, options?)`
- re-exported from [`@nestling/ports`](../nestling.ports), so a CI test is
  one import: `snapshotContracts`, `serializeSnapshot`, `diffContracts`,
  `formatCompatibility`
