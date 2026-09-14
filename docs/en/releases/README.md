# Releases

A release note describes one version, for someone upgrading the
application from the previous one. It names what changed, shows the
code before and after, and leads to the guide chapter or the recipe
where the change is described in full. All `@nestlingjs/*` packages
ship as one version, so there is one note per release.

| Version | Highlights |
|---|---|
| [0.4.0](./v0.4.0.md) | A configuration source behind the coordinates of another source — the `needs` field, the `@nestlingjs/config.vault` package, an unreachable operation as a BUILD phase failure, the nature of a bus as the `remote` field of the declaration, a failure under `argv()` as a message and exit code `1`, `nats` in the peer dependencies, the `conditional-spread` and `no-process-globals` lint rules |
| [0.3.0](./v0.3.0.md) | `build(argv(process.argv))`, configuration bindings on `run()`, `server()`, a status and a branching of outcomes in the declaration, an HTTP failure as an RFC 9457 document, a metric as a declaration, the `logging`, `logging.pino`, `prometheus` and `otel` packages, `make*` plugin factories |
| [0.2.0](./v0.2.0.md) | `httpEndpoint.get('/users', { … })` and five neighbours by method, `httpEndpoint.implement`, the command name as the first argument of `cliEndpoint`, the early success of a pre-step `done()`, the `drizzle.pg`, `inbox` and `mcp` packages, traces and metrics in the kernel, `openapi.zod` → `schema.zod`, barrels listing the names |
