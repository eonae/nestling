# Compatibility

This document names the environment Nestling runs in and the protocols it
serves itself. Anything absent from the tables below is neither tested nor
promised: the framework is being developed towards V1, and the list grows
as consumers appear.

## 1. Runtime

| What | Requirement |
|---|---|
| Node.js | 24 and above |
| Module format | ESM: every package has `"type": "module"`, and `exports` carries neither `main` nor `require` |
| TypeScript | the repository builds with version 5.7; no lower bound is declared for the consumer |
| Decorators | ECMAScript decorators, without `experimentalDecorators` and without `reflect-metadata` |

Node 24 is a hard requirement, not a recommendation. The request context
lives in `AsyncLocalStorage`, and before Node 24 the storage turned on
promise hooks for the whole process: the measurement showed about 14% of
the throughput. In Node 24 the storage works on `AsyncContextFrame`, and
that cost disappears — the entry [ideas.md](../decisions/ideas.md)
`[2026-09-05] Целевая версия Node — 24`.

Decorators are needed by whoever writes an application. Packages are
published built, so their code no longer contains decorators. The code of
an application does, and it is transpiled by the tool that builds or runs
that application.

## 2. Other runtimes

Nothing is promised for any of them. Below is what is known today, so that
it is not established again in every discussion.

| Runtime | State |
|---|---|
| Bun | not tested; implements `node:http` and `AsyncLocalStorage`, so it is likely to run |
| Deno | not tested; reads `node_modules`, implements `node:http` and `AsyncLocalStorage` |
| workerd, edge platforms | does not fit the process lifetime model |

The first two are untested rather than rejected: the price of testing is a
run of the specs and the examples, and until a consumer appeared nobody
paid it.

An edge platform differs not in the set of APIs but in having no
long-lived process. The START and RUN phases rest on such a process, and
so do the relay of `@nestlingjs/outbox`, the sweeper of
`@nestlingjs/inbox` and the subscription registry. That is a different
profile of an application, not a different runtime for the same one.

## 3. Protocols

The `@nestlingjs/transport.http` package serves HTTP/1.1 over `node:http`.
The body formats are JSON, NDJSON, SSE and multipart; the full list of
what the package promises is in
[design/transports.md §4.1](./design/transports.md).

| Protocol | Who serves it |
|---|---|
| HTTP/1.1 | `@nestlingjs/transport.http` |
| HTTP/2, TLS | a reverse proxy in front of the service |
| WebSocket | a separate transport, planned as row 98 of the [roadmap](../decisions/roadmap.md) |
| gRPC | a separate transport, planned as row 99 of the [roadmap](../decisions/roadmap.md) |
| NATS | `@nestlingjs/transport.nats` |
| MCP | `@nestlingjs/mcp` on top of an HTTP server |

A transport over another server is written as a separate package out of
the public exports of `@nestlingjs/transport.http`, touching neither the
kernel nor the package itself. The satellite in the package spec is built
that way: its own `node:http` server, an `ITransport` implementation over
it, and no workaround code was needed.

## 4. The browser

One package builds for the browser — `@nestlingjs/client`. It depends only
on `@nestlingjs/operations` and the global `fetch`.

The other packages are server-side: they read configuration from the
environment, open sockets and hold resources.

## 5. External systems

| System | Package |
|---|---|
| PostgreSQL | `@nestlingjs/drizzle.pg` over `drizzle-orm` and `pg` |
| NATS, including JetStream | `@nestlingjs/transport.nats` |

The stores of the outbox and of the inbox are declared as interfaces, and
the adapter to PostgreSQL is a separate package. An adapter to another
database is written against the same interfaces.
