# Packages

Every package the framework publishes, with the one thing that makes you
take it. All of them ship one version at a time, so a project pins the same
number everywhere. Read the README of a package for its full list of
exports; this table only says when the package is the answer.

## The core and a transport

| Package | When you need it |
|---|---|
| `@nestlingjs/app` | always: the root, features, config sections, the pipeline, ports between features, metrics and the phases |
| `@nestlingjs/container` | always: `@Component`, `@Resource`, `@Handler`, `makeToken`, `makeModule`, providers |
| `@nestlingjs/operations` | always: `makeRequest`, `makeCommand`, `makeEvent`, `makeFail`, io forms, `Ok`, `errorsOf`. It imports no server code, so a browser bundle can import it too |
| `@nestlingjs/transport.http` | the service answers over HTTP: `httpEndpoint`, `server()`, `http()`, `HttpResponse`, and `adapter()` for a foreign process |
| `@nestlingjs/transport.nats` | calls and events travel between processes over NATS |
| `@nestlingjs/transport.cli` | the same endpoints and layers are wanted as commands, with stdin as the stream |
| `@nestlingjs/mcp` | an agent calls the same endpoints as tools over MCP |

## Around the application

| Package | When you need it |
|---|---|
| `@nestlingjs/testing` | any test: `buildTest`, `testBundle`, `checkTopologies`, `stub`, `vars`, `unwrap` |
| `@nestlingjs/client` | a browser or another service calls these operations: `makeClient(record, config)` turns the declarations into a typed API and rebuilds failures by code |
| `@nestlingjs/openapi` | the document has to exist: `makeOpenapi()` builds it from the declarations that already validate requests |
| `@nestlingjs/eslint-plugin` | the three rules an editor can check: an import past a barrel, a declaration without the required layer, and a dependency list that does not match the constructor; the last one fills an empty `@Component()` in with `--fix` |
| `@nestlingjs/schema.zod` | the TypeScript type exists already — generated from proto, GraphQL or OpenAPI — and a schema has to describe exactly it; or a schema written for a vendor other than the framework's needs a converter |
| `@nestlingjs/subscriptions` | streams and SSE are open and someone has to list them, close one, or watch the list change |
| `@nestlingjs/config.vault` | a secret comes from HashiCorp Vault and has to be read on phase 0 |
| `@nestlingjs/agent-skill` | this skill: the command `npx @nestlingjs/agent-skill` puts a copy of it into a project |

## Observability

| Package | When you need it |
|---|---|
| `@nestlingjs/logging` | the `Logger` interface and `makeConsoleLogger` on their own, for a script outside an application. Inside one they arrive with `@nestlingjs/app` |
| `@nestlingjs/logging.pino` | records go through pino: `pinoLogger()` under the same `Logger` interface, with redaction and serialisers of the library |
| `@nestlingjs/prometheus` | the metrics declared by features have to be scraped: `makePrometheus()` serves `GET /metrics` on the socket of the application |
| `@nestlingjs/otel` | spans leave over OTLP, and metrics are pushed rather than scraped: `otel()` gives a pipeline layer and a plugin |

## Storage and delivery

| Package | When you need it |
|---|---|
| `@nestlingjs/drizzle.pg` | PostgreSQL through drizzle-orm: the connection as a resource, the transaction of a request as a context variable, and the stores of outbox and inbox |
| `@nestlingjs/outbox` | an event must leave even if the process dies right after the commit: the record goes into the transaction that changed the data, and the send happens after it |
| `@nestlingjs/inbox` | the same event arriving twice must not change the state twice: the mark "handled" is committed by the transaction that did the change |

## Utilities of the repository

An application does not take these: they are the parts the framework itself
is assembled from, and they are published only because the packages above
depend on them.

| Package | What it is |
|---|---|
| `@nestlingjs/common.graphs` | a directed acyclic graph: topological walk and cycle detection |
| `@nestlingjs/common.misc` | the schema kernel over Standard Schema and shared helper types |
| `@nestlingjs/common.static-server` | a static file server on `node:http` with no dependencies |
