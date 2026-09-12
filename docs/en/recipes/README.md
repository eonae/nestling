# Recipes

A recipe solves one task and is read separately from the others. The list
has no reading order: a recipe has no number, and the name of the file
names the task. The concepts a recipe uses are introduced by the
[guide](../guide/README.md) — the recipe refers to them instead of
repeating them.

| Recipe | Task | Example |
|---|---|---|
| [Webhook with a signature check](./webhook.md) | `rawBody`, a layer that requires the start context | `app-with-http` |
| [A CLI tool on the same primitives](./cli.md) | `cliEndpoint`, `cli()`, argv and REPL, a stream from stdin | `simple-cli` |
| [Dependencies by name and contributions collected from modules](./token-families.md) | DI token families, `familyProvider`, `.auto` on `Logger$`, `.all` | `container` |
| [Configuration from a file and without a restart](./config-sources.md) | sources and binding, `.keys`, shared keys, `reloadable` | `container` |
| [Who is connected right now and how to disconnect them](./ops.md) | the registry of subscriptions, `tracked`, administrative endpoints | `app-with-http` |
| [Without `makeApp`](./standalone.md) | `makeDispatch`, `serve`, `ContainerBuilder` | `simple-http-server`, `container` |
| [Extend the kernel with your own package](./extending.md) | the boundary of the kernel, a satellite, the `./testing` subpath | `nestling.subscriptions` |
| [Alternative shapes](./alternatives.md) | a function with `deps`, a failure thrown, `.ok` and `.catch` | `app-with-http` |
