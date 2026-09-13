# Testing: `@nestlingjs/testing`

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-10] Пакет тестирования (@nestlingjs/testing)`.
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-09-03] Декларация приложения: makeApp, assemble(select), AssembledApp`,
> `[2026-09-06] Фаза 0 BOOTSTRAP: источники до сборки, синхронный build(), фабрики без I/O`,
> `[2026-09-06] Ресурсы и роли классов: @Component, @Resource, @Handler; экземпляры на INIT`,
> `[2026-09-06] Переключатели состава: makeSwitch, pick и when, аргумент сборки`,
> `[2026-09-13] Конфигурация: привязки на run(), env() и dotenv() умолчанием, bind(), needs у источника`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. Test levels and the visibility boundary

The test surface matches the export surface. Everything is visible
inside a package, so unit and module tests substitute any provider. An
application sees only the public DI tokens and the test surfaces of
the modules, so app tests substitute dependencies at the boundaries
between modules and features. A private provider of another module
cannot be substituted: either the module exports a test surface (§5),
or the substitution happens at the boundary, or the test needs to be
written at another level. The package itself is small: testability
comes from the architecture, not from the package.

## 2. Level 0: with no framework

A unit test has no imports from `@nestlingjs/*`. Everything the test
needs is created by hand:

- a provider is a class or a factory with explicit dependencies;
- configuration is an object literal;
- a port is an object with a `call` method;
- a handler is a call to a factory or a class with fakes.

## 3. `assembleTest`: the test composition root

```typescript
import { app } from './app';   // the same makeApp declaration as main.ts uses

const spy = spyLogger();

await using testApp = await assembleTest(app, {
  overrides: [
    [OrdersRepository, inMemoryOrdersRepo()],
    [RootLogger$, spy.logger],
  ],
  config: vars({ ORDERS_MAX_ITEMS: '10' }),
  stubs: [stub(ChargeCard, async () => ({ chargeId: 'test' }))],
});

const res = await testApp.call(CreateOrder, { items: [...] });
```

### Substitution: `overrides`

A substitution is replacing a graph node on phase ASSEMBLE, before the
instances are created. The `overrides: [[Token, fake]]` field exists
only on the test root; `makeApp` does not accept it. Only a DI token
you have a reference to can be substituted; there is no string form
like `overrideByName('…')`. The pair is typed: a fake that is not
compatible with the type of the DI token is a compilation error.
Substituting a DI token that is not in the graph is an assembly error:
after a provider is renamed, the test does not silently substitute an
empty spot.

### Supplying what is missing: `stubs`

`stubs:` supplies what is not in the graph, and unlike `overrides:` it
does not require the DI token to already have a provider. One list
accepts both pairs of a DI token and a value, and stubs of operations,
`stub(Operation, impl)` (§4).

### Pruning

A subtree that depended only on the replaced node drops out of the
graph: after a repository is substituted, the pg pool is neither
created nor connected. `testApp.pruned` shows exactly what dropped out
(a list of node ids); `testApp.stubbed` shows which operations were
stubbed (names in alphabetical order). Both fields are values, not
console output: they are checked against the `.check()` matrix (§6).
With no `overrides`, pruning changes nothing: the graph stays the
same down to the last node ([container.md](./container.md)).

### A run with no sockets and `run()`

The test application goes through phases 0–3 (BOOTSTRAP…WIRE):
`dispatch` is created, START does not run, the transports accept no
requests, and the `SIGTERM`/`SIGINT` handlers are not installed. The
consequence: the background work of `@OnStart` does not run in an app
test. Resources are acquired on INIT, so they are open in a test; the
ones you do not need are substituted through `overrides`, and pruning
removes them from the graph.

`testApp.run()` continues from START to RUN: the transports open
sockets, the signal handlers are installed, and `testApp.baseUrl`
gives the address of the HTTP server. This is e2e in the same process,
with the same `overrides`, `stubs` and `config` as a run with no
sockets. Port `0` in `vars` gives a free port.

`await using` runs SHUTDOWN in reverse order. `close()` is also
available explicitly; calling it again is safe.

### `testApp.call` and `testApp.emit`

`testApp.call(Endpoint, input)` and `testApp.emit(Operation, payload,
meta?)` are typed by the schemas of the declaration: `input` by the
`input` shape, the result by `ResponseContext<InferOutput<O>>`, the
failure branch carries `status` and `code` from the closed `errors:`
list. The request goes through the full pipeline; this is how an app
test differs from a unit test. `unwrap(res)` covers the frequent case
of "I expect success".

Transport binding does not run here: `call` accepts a ready payload.
The e2e tests and the unit tests of the bind map check the layout of
path/query/body by the bind map.

`emit` delivers an event or a command to every subscriber in this
process, each through its own pipeline, and returns their responses
with the name of each: `{ subscriber, response }[]`. A production
`emit` does not wait for the handling, because the publisher is not
responsible for it; a test is responsible for exactly that, and
waiting here is safe — there is no socket, and the subscribers are in
the same process. Zero subscribers for an `event` is a valid broadcast
and an empty list; for a `command` it is an addressing error.

### Policies

Policies are taken from the `makeApp` declaration and checked by the
same pass of phase ASSEMBLE. The test root does not relax the
invariants: an application that does not assemble in production must
not assemble in a test either ([pipeline.md §7](./pipeline.md)).

### Asynchrony

`assembleTest` is asynchronous: `await using` waits for dispose, not
for the initializer, so `await` before the call is mandatory. The form
without `using` (`const testApp = await assembleTest(app, …)` and
`await testApp.close()`) is also supported — for `beforeEach`/`afterEach`.

## 4. Substitution boundaries in an app test

There is no need for foreign DI tokens: the substitution happens at
the public boundaries.

### Configuration: `vars`

`vars({...}, name?)` is an object `ConfigSource` from
`@nestlingjs/testing` with `watch` and the programmatic `set()` and
`assign()`. It is also used to test the reload machinery:
reprojecting, keep-last-good, `onChange`. The test root has no default
sources and does not read `process.env`: a key that is not in `vars`
is absent, so the tests are hermetic and run in parallel. `config:`
accepts a list of `bind(...)` bindings ([config.md §3](./config.md)).
One source is passed as `config: vars({...})`, shorthand for
`[bind(vars({...}))]`.

### Calls between features: `stub`

`stub(Operation, impl)` creates a fake caller as a value. It returns a
pair of the DI token of the caller and the fake (`[C.caller, …]` for
`request`, `[C.emitter, …]` for `command`/`event`), which is passed
through the `stubs:` field. The stub's provider takes priority over
the recipe of the caller family, so the production
`buildPort`/`buildEmitter` for this operation is never called and the
reachability check does not fire: the consumer feature assembles and
works even if the operation has no implementation in this assembly
and the bus delivers nothing outward.

The fake is checked by the schemas of its operation on every call: the
input by the `input` shape, a successful result by the `output` shape.
A returned or thrown failure must be part of the operation's `errors:`
(plus the kernel codes), or the stub throws an exception. This way a
stub cannot drift apart from the operation. Checking the output makes
the stub stricter than a production port in the same process: a
production response has the implementation's pipeline behind it, a
stub has no pipeline.

The call profile is honoured: an exhausted `meta.deadline` gives
`Timeout` before the fake is called, and a command's `emit` always
carries `idempotencyKey`. The type on the calling side matches
production (`Port<C>`/`Emitter<C>`, the result is `PortResult<C>`); an
incompatible fake is a compilation error. A stub has no spy of its
own: `impl` is an ordinary function, so `jest.fn()` works in this
role.

### The request context: `contextValue`

`contextValue(RequestId, 'req-1')` is shorthand for
`valueProvider(Ctx(X), reader)`. The reader of an ambient variable is
an ordinary graph node, so it is substituted through the same
`overrides:` list as everything else. The substituted value takes
priority over the family recipe and works outside a request, so ALS is
not needed in tests. A test that did not substitute the reader sees
the production projection on `testApp.call`
([container.md](./container.md)).

### Cross-cutting dependencies: `familyOverride`

`familyOverride(GrpcClient$, () => fakeClient)` substitutes the whole
recipe of a family, before its members are created, so the production
recipe is never called. It is passed through the same `overrides:`
list.

### Logger entries: `spyLogger`

`spyLogger()` returns `{ logger, entries }`: a kernel logger that
accumulates `{ level, message, fields }` entries as values.
Substituting `[RootLogger$, spy.logger]` intercepts the entries of
every `Logger$` member — of the kernel and of the application: a
family member is built as `root.child({ scope })`
([container.md](./container.md), "The kernel logger"), and the spy's
child logger writes into the same list. A test checks `entries` by
field, not by parsing `stderr`. The same logger is passed straight
into a unit (`withRequestLogging(spy.logger)`), or into
`makeDispatch(endpoints, { logger })` with no `App`.

### The transport

The transport is not substituted: requests travel through `dispatch`
inside the process. There is no `transports` list in the test options
at all: the composition comes from the declaration, and the test run
does not execute START, so the socket never opens and there is
nothing to substitute a port for. An endpoint on a transport outside
the graph gives the same fail-fast on phase ASSEMBLE as in production.

## 5. The test surface of a module: the `./testing` subpath

A module exports its test surface through a conditional export with
the `"testing"` condition. The condition is on only in the test
runner, so an import from production does not resolve at the level of
Node resolution: the boundary is structural. The surface carries the
DI tokens allowed for substitution, and ready-made fakes
(`inMemoryOrdersRepo()`), which the author of the module keeps in step
with the implementation.

The kernel follows the same convention: the internal boundary through
which `@nestlingjs/testing` drives the application through phases 0–3
is exported from `@nestlingjs/app` at the subpath
`@nestlingjs/app/testing`, not through a public export.

## 6. `check()`: a structural check of topologies

`.check()` goes through phases 0–1: the graph is checked, instances
are not created, resources are not acquired. It checks cycles, port
binding, the completeness of the environment, the branches of the
switches, and the declared `policies:` — one test per deployment
variant. This is a method of the `makeApp` declaration, not of an
assembled or test application: `check()` compensates for pruning, so
it works on the full graph and accepts no substitutions. The method
returns a report on the composition: the features, the endpoints by
transport with the `detached` reasons, the transports. It throws the
same errors `run()` would throw on these phases, and it does not
affect a later `run()` of the same application. The `check(args?,
options?)` arguments are optional: the first is the assembly argument
(the feature selection and the switch values), the second is options:
the schema converters and `config` in place of the default sources.

```typescript
for (const features of ['all', 'orders', 'billing'] as const) {
  await app.check({ features, storage: 'local' });
}
```

The matrix of topologies (the feature selection and the switch
values) is checked in CI with no deployment, by one helper:
`checkTopologies(app, args, options?)`. The kernel fails on the first
error, while the helper gathers every failure and fails with one
message, naming the topology for each. The policies from the
declaration are checked in every topology, so a violation that only
shows up on a subset of features is also caught in CI. The composition
of the `detached` endpoints is compared by the value from the report;
there is no need to parse stdout.

The report of every topology carries an `operations` field — the
descriptors of the operations it published. Stubs are checked against
the same field: every stubbed operation must be published by at least
one complete topology, or the stub is covering up a missing
implementation.

```typescript
const published = new Set(
  (await checkTopologies(app, ['all', 'orders', 'notifications']))
    .flatMap(({ report }) => report.operations.map((c) => c.name)),
);

expect(testApp.stubbed.filter((name) => !published.has(name))).toEqual([]);
```

This is the mechanical form of the rule "when you substitute, check
the topology". There is no separate helper for it: both sides of the
comparison are already values.

The same reports assemble a schema compatibility check, with no
rebuild of the application:

```typescript
const reports = await checkTopologies(app, ['all', 'orders'], {
  converters: [zodConverter()],
});

const report = diffOperations(readBaseline(), snapshotOperations(reports));
console.log(formatCompatibility(report));

expect(report.breaking).toEqual([]);   // the test decides whether to fail
```

The reports of the topologies are merged; the verdicts and the rules
are described in [operations.md](./operations.md) §1. The framework
prints the report; there is no "fail on breaking" flag, the user sets
whether the test fails through `expect`. `snapshotOperations`,
`diffOperations` and `formatCompatibility` are re-exported from
`@nestlingjs/testing`, so a CI test is written with one import.

`.check()` creates no instances, so the constructors and `acquire`
never run inside it.

## 7. `testUnit(U, { stubs })`: a unit in isolation

A mini application around one feature or one plugin — with its
modules and their `dependsOn`, the kernel's configuration module, and
stubs. The same phases 0–3 and the same result as `assembleTest`.
Unsatisfied dependencies must be stubbed explicitly; the error lists
every missing DI token with its consumer, not only the first one
found. `testUnit` lives inside the package of the unit, so the DI
tokens are visible with no export. The `stubs` field also accepts
stubs of operations: a call to another feature declared by this unit
is supplied through the same field as a missing provider.
