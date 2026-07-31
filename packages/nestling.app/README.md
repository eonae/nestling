# @nestling/app

Composition root for Nestling: `assemble(spec)` builds the DI container,
discovers endpoints by walking the tree of registered modules
(`modules` + their `imports`), drives the lifecycle phases and handles
graceful shutdown (SIGTERM/SIGINT).

```typescript
const app = assemble({
  modules: [LoggerModule, UsersModule],
  transports: [http({ port: 3000 })],   // a provider, not an instance
});
await app.run();
```

Every field of the spec is optional (`modules`, `providers`, `features`,
`select`, `transports`, `config`). There is **no public constructor**: `App`
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
| 1 ASSEMBLE | selection → module tree → discovery → `build()` → transport tokens and io forms are checked |
| 2 INIT | `@OnInit` in topological order; `dispatch` does not exist yet |
| 3 WIRE | declarations resolve their deps; one `dispatch` per transport |
| 4 START | `@OnStart` in topological order, then `serve(dispatch, signal)` |
| 6 SHUTDOWN | `abort(signal)` → `close()` of transports in reverse → `container.destroy()` |

Phases 0 and 1 are fail-fast: a missing transport, an unsupported io form or
an unregistered dependency of a declaration kills startup **before** any
`@OnInit` grabs a resource. Both `run()` and `close()` are idempotent.

## `check()` — a structural smoke test

```typescript
for (const select of ['all', 'users', 'logging'] as const) {
  const report = await assemble({ features, select, transports: [http()] }).check();
  // report: { features, endpoints: [{ pattern, transport, module }], transports }
}
```

`check()` runs phases 0–1 only: selection, registration, discovery, `build()`
(constructors do run), the transport check and the io form check. It does
**not** run `@OnInit`, `@OnStart`, `serve` or `@OnDestroy`, so nothing grabs a
resource — provided constructors do not, which the phase model forbids
anyway. It throws exactly the errors `run()` would throw on those phases, and
it neither stores its container nor affects a later `run()` of the same
application, which is what makes it usable as a CI matrix over `select`
topologies ([`checkTopologies`](../nestling.testing)).

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
export const LoggingFeature = makeFeature({ name: 'logging', modules: [LoggerModule] });
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [LoggingFeature],      // values, not names
});

const cfg = load(RootConfig);       // phase 0: only process.env
await assemble({
  features: [UsersFeature, LoggingFeature],
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
