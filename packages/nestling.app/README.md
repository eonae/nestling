# @nestling/app

Composition root for Nestling: `assemble(spec)` builds the DI container,
discovers endpoints by walking the tree of registered modules
(`modules` + their `imports`), drives the lifecycle phases and handles
graceful shutdown (SIGTERM/SIGINT).

```typescript
const app = assemble({
  modules: [LoggingModule, UsersModule],
  transports: [http({ port: 3000 })],   // a provider, not an instance
});
await app.run();
```

Every field of the spec is optional (`modules`, `providers`, `features`,
`select`, `transports`, `config`, `policies`), and **that list is closed**.
There is no `plugins:` field — nor any other bag for cross-cutting
infrastructure: process-global infrastructure arrives through the same
`modules:`/`providers:`, feature-scoped infrastructure through the modules of
its feature, and there is no `Plugin` primitive to declare in the first
place. There is **no public constructor**: `App`
is the result type with `run()`, `check()` and `close()`, and its constructor
takes an internal plan whose type is not exported — `new App({ … })` is not
expressible. `overrides` is not a field of this spec and never will be:
substituting a graph node is a property of a test run, and the key lives on
the test composition root only ([`@nestling/testing`](../nestling.testing)).

## Phases

`run()` walks `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE → 4 START →
5 RUN`; `close()` performs `6 SHUTDOWN` as a strict reverse of START.

| Phase | What happens |
|---|---|
| 0 BOOTSTRAP | outside `assemble`: `load(section)` in the root computes `select` |
| 1 ASSEMBLE | selection → module tree → discovery → `build()` → transport tokens and io forms are checked → declared `policies` are checked |
| 2 INIT | `@OnInit` in topological order; `dispatch` does not exist yet |
| 3 WIRE | declarations resolve their deps; one `dispatch` per transport; contract invokers are bound and the bus subscribes to its subjects |
| 4 START | `@OnStart` in topological order, then `serve(dispatch, signal)` |
| 6 SHUTDOWN | `abort(signal)` → `close()` of transports in reverse → `container.destroy()` |

Phases 0 and 1 are fail-fast: a missing transport, an unsupported io form or
an unregistered dependency of a declaration kills startup **before** any
`@OnInit` grabs a resource. Both `run()` and `close()` are idempotent.

Three kernel modules are registered unconditionally — config, ambient
context and **ports** ([`@nestling/ports`](../nestling.ports)) — so the root
never has to mention them. They cost nothing when unused: their nodes are
token-family members, materialized only when something injects them, and
the bus transport is registered only when the app has at least one contract
implementation. Discovery runs before module registration because the ports
kernel needs the topology of implementations at registration time; the
function is pure, so the order changes nothing else.

### `policies` — invariants over the assembled graph

```typescript
assemble({
  features: [UsersFeature],
  transports: [http()],
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase, 'authedBase'),
    everyEndpoint({ transport: HttpTransport$ }).hasVar(RequestId, 'requestId'),
  ],
});
```

The dictionary of predicates lives in
[`@nestling/pipeline`](../nestling.pipeline); this package only collects the
subjects from discovery, calls `check` and formats the result — it never
inspects a policy. Three properties are worth stating:

- **Last check of the phase.** Policies run after the transport and io-form
  checks: a policy complaining about an endpoint whose transport is missing
  would point the author at the wrong problem. Nothing reaches `@OnInit`.
- **One aggregated diagnostic.** Every policy runs to the end; violations are
  grouped per policy, and the message names their number, the policy
  description, each offending endpoint (pattern, transport, declaring module)
  and both fixes — compose the layer, or mark `detached: '<reason>'`.
- **Only endpoints of the selected topology** are checked: discovery walks
  the tree of registered modules, so an endpoint of a feature `select` left
  out is not in the set at all.

Endpoints marked `detached` are excluded from every policy and printed at
startup, one line each, right after the assembly summary:

```
[nestling] features: users, ops; transports: http
[nestling] detached from policies: GET /health (http) — liveness probe of the load balancer
```

## `check()` — a structural smoke test

```typescript
for (const select of ['all', 'users', 'ops'] as const) {
  const report = await assemble({ features, select, transports: [http()] }).check();
  // report: {
  //   features,
  //   endpoints: [{ pattern, transport, module, detached? }],
  //   transports,
  //   contracts: [ContractDescriptor],
  // }
}
```

`check()` runs phases 0–1 only: selection, registration, discovery, `build()`
(constructors do run), the transport check, the io form check and the
declared `policies`. It does
**not** run `@OnInit`, `@OnStart`, `serve` or `@OnDestroy`, so nothing grabs a
resource — provided constructors do not, which the phase model forbids
anyway. It throws exactly the errors `run()` would throw on those phases, and
it neither stores its container nor affects a later `run()` of the same
application, which is what makes it usable as a CI matrix over `select`
topologies ([`checkTopologies`](../nestling.testing)).

`check(options?)` takes an optional dictionary carrying schema converters:

```typescript
const report = await assemble(spec).check({ converters: [zodConverter()] });
```

`report.contracts` holds descriptors of the contracts this topology
**publishes** — built from discovery, by declarations carrying a bus binding,
and never read from the private `makeContract` registry: the tree of modules
is the single source of truth about what an application serves, and an
imported-but-unimplemented contract does not appear. A missing converter for
a leaf's vendor is not an error — the leaf is marked opaque and `check()`
does not fail. Descriptors are values
([`@nestling/ports`](../nestling.ports)); feeding a matrix of them to
`snapshotContracts`/`diffContracts` is how the contract compatibility report
is produced. Calling `check()` with no argument behaves exactly as before.

## `./testing` — the test seam

The seam that drives an application through phases 0–3 and stops lives in a
conditional subpath, `@nestling/app/testing`, not in the main export. The
`"testing"` condition is enabled by the test runner only, so a production
import does not resolve **at the Node level** — the boundary is structural
rather than a convention. Package authors are asked to follow the same
convention for their own test surfaces, so the kernel dogfoods it.

Application code therefore sees no `overrides` and no way to stop at WIRE.
Use [`@nestling/testing`](../nestling.testing) instead of the seam directly.

## Features and `select`

```typescript
export const OpsFeature = makeFeature({ name: 'ops', modules: [OpsModule] });
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],           // UsersModule imports its infrastructure
  dependsOn: [OpsFeature],          // values, not names
});

const cfg = load(RootConfig);       // phase 0: only process.env
await assemble({
  features: [UsersFeature, OpsFeature],
  select: cfg.features,             // 'all' | 'users' | ['users', 'billing']
  transports: [http()],
}).run();
```

A feature is a value: declaring one registers nothing. Features reachable
through `dependsOn` join the selection even when they are not listed in
`features:`; a cycle there is legal (the field states necessity, not build
order). A feature that is not selected is absent from the application
entirely — its providers are never instantiated and its endpoints are
registered nowhere.

Selection mismatches fail on phase ASSEMBLE: an unknown name (the error
lists the available ones), two different features with the same `name`, an
empty selection (`''`/`[]` — "nothing" is written by declaring no features)
and `select` without `features`.

`modules:` of the root and the modules of the selected features are merged;
modules are deduplicated **by value**, exactly as in `ContainerBuilder`. Two
different module values with one `name` fail the build — and discovery
applies the same rule when it walks the tree, so "what is discovered" never
drifts from "what is registered" by silently dropping a module together with
its endpoints. In an `assemble` run the message comes from the container:
modules are registered before discovery walks them.

## Transports

Transports are ordinary providers: `transports:` is sugar for registering
them, and the same provider is equally valid in `providers:` of any module,
including a feature's infra module. The set of transports is **derived**:
tokens referenced by discovered declarations ∪ tokens of the providers in
`transports:`. A transport with no discovered handles still goes live.

`endpoints:` holds **declaration values** (`httpEndpoint`, `cliEndpoint`),
not class constructors. `makeAppModule` keeps that list and adds nothing to
`providers`: there is nothing to instantiate. A handler's dependencies —
tokens listed in `deps`, a class handler, a pipeline's class units — are
ordinary providers and must be registered in `providers:` explicitly.

An endpoint is served only when it is listed in the `endpoints:` array of a
module reachable from `modules` — importing the file that declares it has no
effect (there is no global registry). Start fails fast when an element of
`endpoints:` is not a declaration (the error names the module and the index
in the array), when a dependency of a declaration is missing from the
container (the error names the dependency, the handler's pattern and the
declaring module), or when a declaration references a transport token that
the container cannot resolve (the error names the transport, the pattern,
the module and how to fix it).

In phase WIRE the app calls `endpoint.resolve(resolver)` for every
discovered declaration and builds one `dispatch` per transport
([`@nestling/transport`](../nestling.transport)); the transport receives it
as an argument of `serve` in phase START.

## Configuration

The config kernel module ([`@nestling/config`](../nestling.config)) is
registered **always**, so an application that is happy with `process.env`
writes nothing about config in its root. When there are other sources, they
are bound with a flat list where order is priority:

```typescript
const app = assemble({
  modules: [OrdersModule],
  transports: [http()],
  config: [
    [vault(), [ordersKeys]],          // section key handles
    [file('config.yaml'), ['*_URL']], // and key globs
  ],
});
```

`process.env` is an implicit floor: it is consulted last and cannot be listed.
Config sections consumed by the graph are projected and validated during
`build()`, so an invalid config kills startup **before** any transport starts
listening. `ConfigBinding` and `ConfigTarget` are re-exported here, so a root
does not have to import `@nestling/config` for one annotation.

## Ambient request context

The reader kernel module of the ambient context
([`@nestling/pipeline`](../nestling.pipeline)) is registered **always**, for
the same reason and at the same price as the config one: members of the `Ctx`
family materialize by the `deps` fixpoint, so with no `Ctx(...)` anywhere the
graph gains no node — and the composition root says nothing about request
context. A class with `Ctx(RequestId)` in its `deps` just assembles and works;
the dependency is an ordinary graph edge, visible in `explain()` and in the
serialized graph. Presence of a variable is an opt-in invariant of the same
`policies:` list — `everyEndpoint(…).hasVar(RequestId)`.

Each declaration's io **forms** is checked against the transport's
`capabilities` in phase ASSEMBLE — richness is declared in the contract and
reconciled at assembly, so `events` on CLI or `multipart` on a value-only
transport fails at startup rather than on the first request.
The message names the endpoint, the declaring module, the transport, the
slot and the form; the same check runs on the standalone path inside the
transport itself (see [`@nestling/transport`](../nestling.transport)).

### Migrating from decorator endpoints

- `@Injectable([...]) @HttpEndpoint(method, path, opts) class X implements
  IEndpoint` → `httpEndpoint({ method, path, …, deps: [...], handle })`, or
  keep the class as a handler and pass it as `handle: X`.
- Class handlers now have to be listed in `providers:` — `makeAppModule` no
  longer copies `endpoints` into `providers`.
- `DiscoveredEndpoint` carries the declaration itself (`endpoint`) plus
  `moduleName`; `transport`/`pattern` are read off the declaration, and the
  separate `metadata` field is gone.
- `assertEndpointsDeclared` is gone: with no metadata on classes there is
  nothing that distinguishes a "forgotten endpoint class" from a plain
  provider.

The traversal is also a public value: `discoverEndpoints(modules)` returns
the endpoints (with the declaring module's name) and the map of required
transports, without a container or transports — see
[`src/discovery.ts`](./src/discovery.ts).

> 🚧 Active development, API evolving. Target design in
> [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guides: [composition root](../../docs/guides/composition.md) (phases,
features, `select`) and [app with DI](../../docs/guides/http-app-di.md).
