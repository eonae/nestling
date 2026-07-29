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

An endpoint is served only when it is listed in the `endpoints:` array of a
module reachable from `modules` — importing the file that declares it has no
effect (there is no global registry). Start fails fast when a class in
`endpoints:` carries no endpoint metadata, when a class carrying endpoint
metadata is registered as a provider but declared in no `endpoints:`
(providers produced by a `ProvidersFactory` are not linted — they are
unknown until `build()`), or when a required transport is missing from
`transports`.

The traversal is also a public value: `discoverEndpoints(modules)` returns
the endpoints (with the declaring module's name) and the map of required
transports, without a container or transports — see
[`src/discovery.ts`](./src/discovery.ts).

> 🚧 Active development, API evolving. Target design in
> [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guide: [App with DI](../../docs/guides/http-app-di.md).
