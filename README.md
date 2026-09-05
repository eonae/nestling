# Nestling

> A TypeScript backend framework: smaller, more modern and stricter than NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇷🇺 Русская версия](./README.ru.md)**

## Status

Nestling is under active development towards V1; APIs change. Use in
production at your own risk. Documentation and examples are in Russian.
Requires Node 24.

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
- **One composition root.** `makeApp({ features, plugins, transports,
  config, policies })` declares the application; `assemble(select)` builds it
  for this process and `run()` drives it through the lifecycle phases.

The principles behind the design are described in
[docs/design/principles.md](./docs/design/principles.md) (Russian).

## Quick start

```bash
npm install @nestling/app @nestling/transport.http zod
```

```typescript
import { makeApp, makeFeature } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

// An endpoint is a value: address, schemas and handler in one object
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }), // `id` comes from the path
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => ({ id, name: 'Alice' }),
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

const app = makeApp({
  features: [UsersFeature],
  transports: [http({ port: 3000 })],
});

await app.assemble().run();
```

The application answers `GET /users/42`, validates the input against the
`input` schema and shuts down on `SIGTERM`. The `output` schema types the
handler and describes the response; the typed client checks the body
against it on receipt. Continue with the
[guide](./docs/guide/README.md): it grows this file into an application of
several features running in several processes.

## Documentation

The entry point is [`docs/README.md`](./docs/README.md): the folder map, the
package list and the rules for keeping documentation in sync. The folder
defines the status of a document:

- [`docs/guide/`](./docs/guide/README.md) — the guide to the current API; its
  table of contents lists every chapter, the parts they form and the example
  each chapter is verified against;
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
yarn docs:build      # build the HTML documentation site
yarn bench:http      # HTTP transport against Fastify; a reference point, not a gate
```

A monorepo on Yarn workspaces and Nx: packages live in `packages/`,
documentation in `docs/`.

## Contributing

This is a personal project, but questions and suggestions are welcome: open an
issue.

## License

MIT © 2025
