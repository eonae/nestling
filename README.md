# Nestling

> A TypeScript backend framework: smaller, more modern and stricter than NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇷🇺 Русская версия](./README.ru.md)**

## Status

Nestling is under active development towards V1; APIs change. Use in
production at your own risk. Documentation and examples are in Russian.

## What it is

Nestling assembles an application from declarative values: endpoints,
operations, pipelines, features and modules are plain constants, and the
dependency container verifies the whole graph at startup.

- **A container with no magic.** Dependencies are declared as an explicit
  token list on standard ES decorators, without `reflect-metadata`. The
  graph is built eagerly: a cycle or a missing dependency stops the
  assembly, not a request.
- **Schema-first.** The `input`, `output` and `errors` schemas of an endpoint
  drive validation, handler types, the typed client and the OpenAPI
  document. Any validator that implements
  [Standard Schema](https://standardschema.dev) works: zod, valibot, arktype.
- **A pipeline without `next()`.** Request handling is a flat sequence of
  `.pre`, `.ok`, `.catch` and `.finally` phases; layers are combined with
  `compose`, and an assembly policy verifies that every endpoint carries the
  required layer.
- **Errors as values.** A handler returns `Ok` or `Fail`; the list of
  possible failures is part of the endpoint declaration and reaches the
  client.
- **Operations between features.** A feature calls its neighbour through an
  operation, not through its service. The same code runs in one process and
  in several, over NATS.
- **One composition root.** `assemble({ features, plugins, transports,
  config, policies })` builds the application and drives it through the
  lifecycle phases.

The principles behind the design are described in
[docs/design/principles.md](./docs/design/principles.md) (Russian).

## Quick start

```bash
npm install @nestling/app @nestling/transport.http zod
```

```typescript
import { assemble, makeFeature } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// An endpoint is a value: address, schemas and handler in one object
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }), // `id` comes from the path
  output: z.object({ id: z.string(), name: z.string() }),
  handle: async ({ id }) => ({ id, name: 'Alice' }),
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

await assemble({
  features: [UsersFeature],
  transports: [http({ port: 3000 })],
}).run();
```

The application answers `GET /users/42`, validates input and output against
the schemas and shuts down on `SIGTERM`. Continue with the
[guide](./docs/guide/README.md): it grows this file into an application of
several features running in several processes.

## Guide

| Part | Covers |
|---|---|
| [1. First service](./docs/guide/README.md#часть-1-первый-сервис) | endpoints, schemas, failures, a repository, config, tests |
| [2. Service in production](./docs/guide/README.md#часть-2-сервис-в-проде) | logging, token check, files and streams, OpenAPI and the client |
| [3. The application grows](./docs/guide/README.md#часть-3-приложение-растёт) | features, operations, events, a live feed, testing a feature alone |
| [4. Deploying in parts](./docs/guide/README.md#часть-4-разворачивать-по-частям) | `select`, NATS, operation compatibility |
| [5. Rare tasks](./docs/guide/README.md#часть-5-редкие-задачи) | webhooks, CLI, token families, config sources, operations, no `assemble` |

## Examples

| Example | What it shows | Guide chapters |
|---|---|---|
| [`examples.users-service`](./packages/examples.users-service/) | A users service: endpoints, repository, config, layers, files, OpenAPI, client, tests | 1–10 |
| [`examples.app-with-http`](./packages/examples.app-with-http/) | The same service as three features: operations, events, SSE, `select`, subscription registry, compatibility snapshot | 11–15, 17, 18, 22 |
| [`examples.split-nats`](./packages/examples.split-nats/) | The same features in several processes over NATS | 16 |
| [`examples.simple-cli`](./packages/examples.simple-cli/) | A CLI tool: commands as endpoints, REPL, a stream from stdin | 19 |
| [`examples.container`](./packages/examples.container/) | The container alone: token families, config sources, reloadable config, graph for `viz` | 20, 21, 23 |
| [`examples.simple-http-server`](./packages/examples.simple-http-server/) | HTTP without `assemble`: `makeDispatch` and `serve` | 23 |

## Packages

For application authors:

| Package | What it does |
|---|---|
| [`@nestling/app`](./packages/nestling.app/) | Composition root: `assemble`, features and plugins, `select`, lifecycle phases, policies |
| [`@nestling/transport.http`](./packages/nestling.transport.http/) | HTTP on `node:http`: `httpEndpoint`, routing, JSON, NDJSON, SSE, multipart |
| [`@nestling/operations`](./packages/nestling.operations/) | Shared by server and client: operations, `defineFail`, `Ok`/`Fail`, io forms |
| [`@nestling/config`](./packages/nestling.config/) | Configuration as schema-typed sections, sources and their binding, secrets, reloadable sections |
| [`@nestling/container`](./packages/nestling.container/) | Dependency container: tokens, providers, token families, modules, lifecycle hooks |
| [`@nestling/pipeline`](./packages/nestling.pipeline/) | Request pipeline, layers, policies, async context |
| [`@nestling/ports`](./packages/nestling.ports/) | Implementing and calling operations between features, the in-process bus |
| [`@nestling/testing`](./packages/nestling.testing/) | Test composition root: `assembleTest`, `overrides`, operation stubs, `checkTopologies` |

Transports and the bus:

| Package | What it does |
|---|---|
| [`@nestling/transport.cli`](./packages/nestling.transport.cli/) | CLI commands as endpoints: single-shot and REPL |
| [`@nestling/transport.nats`](./packages/nestling.transport.nats/) | NATS as the application bus: operations across processes, `durable` delivery |
| [`@nestling/transport`](./packages/nestling.transport/) | Transport interface and `makeDispatch` for running without `assemble` |
| [`@nestling/streams`](./packages/nestling.streams/) | `Topic<T>` and stream combinators over `AsyncIterable` |

Tools and satellites:

| Package | What it does |
|---|---|
| [`@nestling/client`](./packages/nestling.client/) | Typed HTTP client built from operations, for frontends and other services |
| [`@nestling/openapi`](./packages/nestling.openapi/) | OpenAPI 3.1 document derived from endpoint declarations |
| [`@nestling/openapi.zod`](./packages/nestling.openapi.zod/) | zod schema converter for `@nestling/openapi` |
| [`@nestling/subscriptions`](./packages/nestling.subscriptions/) | Registry of active subscriptions: list, forced close, live watch |
| [`@nestling/viz`](./packages/nestling.viz/) | Interactive dependency graph visualisation in the browser |
| [`@nestling/eslint-plugin`](./packages/nestling.eslint-plugin/) | ESLint rules: module boundary by barrel, hints on endpoint declarations |
| [`@nestling/models`](./packages/nestling.models/) | zod io models checked against a TypeScript type |

## Documentation

The entry point is [`docs/README.md`](./docs/README.md). The folder defines
the status of a document:

- [`docs/guide/`](./docs/guide/README.md) — the guide to the current API;
  chapters are verified against the example code;
- [`docs/design/`](./docs/design/README.md) — the target V1 state, the full
  API description;
- [`docs/decisions/`](./docs/decisions/ideas.md) — the decision log: what,
  when and why;
- [`docs/glossary.md`](./docs/glossary.md) — terms and how they are written.

Package READMEs document the current state of the code.

## Development

```bash
yarn install
yarn verify          # build + typecheck + lint + test across all packages
yarn docs:audit      # documentation consistency check
yarn docs:preview    # build the HTML preview of the docs
```

A monorepo on Yarn workspaces and Nx: packages live in `packages/`,
documentation in `docs/`.

## Contributing

This is a personal project, but questions and suggestions are welcome: open an
issue.

## License

MIT © 2025
