# A backend put together from values

Nestling is a TypeScript backend framework: smaller, more modern and
stricter than NestJS. An application is put together from declarations
that are values: an endpoint, an operation, a pipeline, a feature and a
module are ordinary constants. The container checks the whole dependency
graph at startup.

[Start in five minutes](./guide/01-first-service.md)
[npm i @nestlingjs/app](https://www.npmjs.com/package/@nestlingjs/app)

```typescript
const ListUsers = httpEndpoint.get('/users', {
  output: z.array(User),
  handler: async () => [{ id: '1', name: 'Alice' }],
});

const app = makeApp({
  endpoints: [ListUsers],
  transports: [http()],
});

await app.assemble().run();
```

::::cards
:::card No runtime magic
Dependencies are listed as DI tokens on standard decorators. There is no
`reflect-metadata` and there are no hidden conventions about names.
:::
:::card Guarantee over convention
A cycle in the graph, a missing dependency or an endpoint without a
required layer stop the build, not the request.
:::
:::card Schema-first
The `input`, `output` and `errors` schemas define the validation, the
types of the handler, the typed client and the OpenAPI document.
:::
:::card Declarations are values
A module is an object, not a class with a decorator. A value can be built
by a function, put into an array and passed on.
:::
::::

## Where to start

The guide leads from the first service to an application of several
features deployed in several processes. The chapters are read in order:
each one rests on the code of the previous one.

- [Bring up a service that answers a request](./guide/01-first-service.md)
  — the first chapter of the path.
- [The whole guide](./guide/README.md) — the contents of both parts and
  the concept map.
- [From NestJS](./from-nestjs.md) — what in Nestling writes down what you
  used to do in Nest.

## What else there is

- [Recipes](./recipes/README.md) — one task per file: CLI, webhooks,
  configuration from a file, work without `makeApp`.
- [Package reference](../../packages/nestling.app/) — what lies in every
  package and how its public names are called; the list of packages opens
  the sidebar.
- [What is checked before the first request](./guarantees.md) — a table of
  the checks, the moment each one fires and the chapter that introduces it.
- [Compatibility](./compatibility.md) — the Node version, the module
  format, the state of other runtimes and the protocols the framework
  serves itself.
- [Target state of V1](./design/README.md) — the full description of the
  target API by subsystem.
- [Glossary](./glossary.md) and [naming conventions](./conventions.md) —
  the dictionary of the documentation and the rules for names in the code
  of an application.

## Status

Nestling is being developed towards V1, and the API changes. Node 24 is
required. The plan of work is the [roadmap](../decisions/roadmap.md),
and the deliberately postponed topics are in
[deferred](../decisions/deferred.md).
