# Nestling

> A TypeScript backend framework written by agents. It serves an agent and a
> human alike: for both it shortens the time between "the code is written"
> and "the code is known to be correct".

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇷🇺 Русская версия](./README.ru.md)**

## What it is

Nestling builds an application from declarations that are values: an
endpoint, an operation, a pipeline, a feature and a module are ordinary
constants. The compiler reads a declaration and the build reads it next, so
the answer "the code is correct" arrives before the first request. The
feedback loop is short in three places.

- **The whole application comes up in one process.** A feature calls its
  neighbour through an [operation](./docs/en/guide/14-features.md) rather
  than over the network: behaviour is checked without a broker, without
  containers and without a deployment. The same declaration is
  [spread across processes](./docs/en/guide/20-split.md) when that becomes
  necessary.
- **An error shows up at compile time.** The `output` schema types the
  handler, the list of [failures](./docs/en/guide/04-errors.md) in the
  endpoint declaration closes the return of an undeclared error, and the
  requirements of a layer to the context are checked at the `compose` point.
- **The build fails before the socket opens.** A cycle in the graph, a
  missing dependency, an endpoint without a required layer and a config key
  that is not found stop the start. What is checked and when is named by the
  [table of checks](./docs/en/guarantees.md).
- **A feature is checked without a server.** The test build `buildTest` runs
  the same declaration through the phases up to `WIRE` and
  [stops](./docs/en/guide/08-testing.md): an endpoint is called through the
  same pipeline, and no socket is opened.

The principles behind the design are described in
[docs/en/design/principles.md](./docs/en/design/principles.md).

## Who it is for

The framework answers the questions an application meets in production:
where the boundary of a feature runs, how a transaction is laid out, what to
do with a failure in a contract, how to spread features across processes. It
answers them with declarations, and those are written before the question
becomes urgent. To a developer who has not met these questions yet, the
declarations will look like extra work.

The concepts are familiar from other frameworks: a module, a provider, an
endpoint, a pipeline and a layer around a handler carry the same names here.
Only the form of the record is new: a declaration lies in a value instead of
being assembled from decorators at startup.

Nestling is not needed by a service that runs in one process, that is called
by no typed client and whose documentation nobody reads. There a declaration
stays a cost, and such a service is cheaper to write on Fastify. Nestling
starts paying off where a feature has to survive a move to another process,
where the caller wants a client generated from the contract, and where the
OpenAPI document has to follow the code rather than trail behind it.

## Status

Nestling is under active development towards V1; APIs change. Use in
production at your own risk. Requires Node 24.

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
- [`docs/en/guarantees.md`](./docs/en/guarantees.md) — what is checked
  before the first request: a table of the checks, the moment each one fires
  and the chapter that introduces it;
- [`docs/en/glossary.md`](./docs/en/glossary.md) — terms and how they are
  written; next to every English term stands its Russian original;
- [`docs/en/releases/`](./docs/en/releases/README.md) — release notes: what
  changed in a version, the code before and after;
- [`docs/decisions/`](./docs/decisions/ideas.md) — the decision log: what,
  when and why. It is written by whoever works inside the repository and
  stays in Russian, as do the code comments and the examples.

Package READMEs document the current state of the code. The rules for
keeping the documentation live in [`docs/README.md`](./docs/README.md).

## Development

```bash
yarn install
yarn verify          # build + typecheck + lint + test across all packages
yarn verify:strict   # checks the built declarations; run before a release
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
