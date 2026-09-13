# Nestling

> A TypeScript backend framework: smaller, more modern and stricter than NestJS.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇷🇺 Русская версия](./README.ru.md)**

## Status

Nestling is under active development towards V1; APIs change. Use in
production at your own risk. Requires Node 24.

## What it is

Nestling builds an application from declarative values: endpoints,
operations, pipelines, features and modules are plain constants, and the
dependency container verifies the whole graph at startup.

- **A container with no magic.** Dependencies are declared as an explicit
  token list on standard ES decorators, without `reflect-metadata`. The
  graph is built eagerly: a cycle or a missing dependency stops the
  build, not a request.
- **Schema-first.** The `input`, `output` and `errors` schemas of an endpoint
  drive validation, handler types, the typed client and the OpenAPI
  document. Any validator that implements
  [Standard Schema](https://standardschema.dev) works: zod, valibot, arktype.
- **A pipeline without `next()`.** Request handling is a flat sequence of
  `.pre`, `.ok`, `.catch` and `.finally` phases; layers are combined with
  `compose`, and a build policy verifies that every endpoint carries the
  required layer.
- **Errors as values.** A handler returns `Ok` or `Fail`; the list of
  possible failures is part of the endpoint declaration and reaches the
  client.
- **Operations between features.** A feature calls its neighbour through an
  operation, not through its service. The same code runs in one process and
  in several, over NATS.
- **One composition root.** `makeApp({ features, plugins, transports,
  config, policies })` declares the application; `build(select)` builds what
  this process runs and `run()` drives it through the lifecycle phases.

The principles behind the design are described in
[docs/en/design/principles.md](./docs/en/design/principles.md).

## When Nestling is not the tool

The guarantees above are paid for up front, in declarations. A service
that will never be split across processes, that is called by no typed
client, and whose documentation nobody reads is cheaper to write on
Fastify: the container, the operations and the schemas buy nothing there,
and the declaration stays a cost. Nestling starts paying off where a
feature has to survive a move to another process, where the caller wants
a client generated from the contract, and where the OpenAPI document has
to follow the code rather than trail behind it.

## Quick start

```bash
npm install @nestlingjs/app @nestlingjs/transport.http zod
```

```typescript
import { makeApp, makeFeature } from '@nestlingjs/app';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

// An endpoint is a value: address, schemas and handler in one object
const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }), // `id` comes from the path
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => ({ id, name: 'Alice' }),
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

const app = makeApp({
  features: [UsersFeature],
  transports: [http({ port: 3000 })],
});

await app.build().run();
```

The application answers `GET /users/42`, validates the input against the
`input` schema and shuts down on `SIGTERM`. The `output` schema types the
handler and describes the response; the typed client checks the body
against it on receipt. Continue with the
[guide](./docs/en/guide/README.md): it grows this file into an application of
several features running in several processes.

## Working with an agent

```bash
npx @nestlingjs/agent-skill
```

The command writes a Claude Code skill into `.claude/skills/nestling/` of
the current project. The skill tells an agent the shape of Nestling code and
the rules it cannot guess from NestJS habits — declarations as values, an
explicit dependency list, failures returned instead of thrown, neighbouring
features reached through operations. Details in
[`@nestlingjs/agent-skill`](./packages/nestling.agent-skill/).

## Documentation

The site is **<https://eonae.github.io/nestling>**; it is published on the
release tag and describes the released version. The same texts live in the
repository: English in [`docs/en/`](./docs/en/index.md), Russian in `docs/`
next to it. The folder defines the status of a document:

- [`docs/en/guide/`](./docs/en/guide/README.md) — the guide to the current
  API; its table of contents lists every chapter, the parts they form and
  the example each chapter is verified against;
- [`docs/en/design/`](./docs/en/design/README.md) — the target V1 state, the
  full API description;
- [`docs/en/glossary.md`](./docs/en/glossary.md) — terms and how they are
  written; next to every English term stands its Russian original;
- [`docs/decisions/`](./docs/decisions/ideas.md) — the decision log: what,
  when and why. It is written by whoever works inside the repository and
  stays in Russian, as do the code comments and the examples.

Package READMEs document the current state of the code. The rules for
keeping the documentation live in [`docs/README.md`](./docs/README.md).

## Development

```bash
yarn install
yarn verify          # build + typecheck + lint + test across all packages
yarn docs:audit      # documentation consistency check
yarn docs:build      # build the HTML documentation site
yarn bench:http      # HTTP transport against Fastify; a reference point, not a gate
yarn pack:check      # install the tarballs into a project outside the repo
```

A monorepo on Yarn workspaces and Nx: packages live in `packages/`,
examples in `examples/`, documentation in `docs/`.

Releasing a version — [RELEASING.md](./RELEASING.md): a human bumps the
version, GitHub Actions publishes on the tag.

## Contributing

This is a personal project, but questions and suggestions are welcome: open an
issue.

## License

MIT © 2026
