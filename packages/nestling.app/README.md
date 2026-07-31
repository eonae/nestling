# @nestling/app

Application assembly for Nestling: wires the DI container with transports,
discovers endpoints by walking the tree of registered modules
(`modules` + their `imports`), runs lifecycle hooks in topological order,
and handles graceful shutdown (SIGTERM/SIGINT).

```typescript
const app = new App({
  modules: [LoggerModule, UsersModule],
  transports: { http: new HttpTransport({ port: 3000 }) },
});
await app.run();
```

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
declaring module), or when a required transport is missing from
`transports`.

On startup `App` calls `endpoint.resolve(resolver)` for every discovered
declaration and hands the transport a runnable value.

## Configuration

`App` registers the config kernel module ([`@nestling/config`](../nestling.config))
**always**, so an application that is happy with `process.env` writes nothing
about config in its root. When there are other sources, they are bound with a
flat list where order is priority:

```typescript
const app = new App({
  modules: [OrdersModule],
  transports: { http },
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

Once `assemble()` lands (change #10) the binding list moves there; it is one
line.

Before that, each declaration's io **forms** are checked against the
transport's `capabilities` — richness is declared in the contract and
reconciled at assembly, so `events` on CLI or `multipart` on a
value-only transport fails at startup rather than on the first request.
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

Usage guide: [App with DI](../../docs/guides/http-app-di.md).
