# @nestling/app

Application assembly for Nestling: wires the DI container with transports,
auto-discovers `@Endpoint`-decorated classes from modules
(`makeAppModule`), runs lifecycle hooks in topological order, and handles
graceful shutdown (SIGTERM/SIGINT).

```typescript
const app = new App({
  modules: [LoggerModule, UsersModule],
  transports: { http: new HttpTransport({ port: 3000 }) },
});
await app.run();
```

> 🚧 Active development, API evolving. Target design in
> [`docs/decisions/ideas.md`](../../docs/decisions/ideas.md).

Usage guide: [App with DI](../../docs/guides/http-app-di.md).
