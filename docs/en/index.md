# A backend written by agents

Nestling serves an agent and a human alike: for both it shortens the time
between "the code is written" and "the code is known to be correct". The
whole application comes up in one process. The compiler shows the error. The
build fails before the socket opens.

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

await app.build().run();
```

::::cards
:::card The whole application in one process
A feature calls its neighbour through an [operation](./guide/14-features.md)
rather than over the network. Behaviour is checked without a broker, without
containers and without a deployment, and the same declaration is
[spread across processes](./guide/20-split.md) when that becomes necessary.
:::
:::card An error at compile time
The `output` schema types the handler, the list of
[failures](./guide/04-errors.md) in the endpoint declaration closes the
return of an undeclared error, and the requirements of a layer to the
context are checked at the `compose` point.
:::
:::card The build fails before the socket
A cycle in the graph, a missing dependency, an endpoint without a required
layer and a config key that is not found stop the start. The whole list is
the [table of checks](./guarantees.md).
:::
:::card A check without a server
The test build `buildTest` runs the same declaration through the phases up
to `WIRE` and [stops](./guide/08-testing.md). An endpoint is called through
the same pipeline, and no socket is opened.
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
- [Releases](./releases/README.md) — what changed in every version: the
  code before and after, where to read more.

## When Nestling is not needed

A service that runs in one process, that is called by no typed client and
whose documentation nobody reads gets nothing back from its declarations.
There they stay a cost, and such a service is cheaper to write on Fastify.
Nestling starts paying off where a feature has to survive a move to another
process, where the caller wants a client generated from the contract, and
where the OpenAPI document has to follow the code rather than trail behind
it.

## Status

Nestling is being developed towards V1, and the API changes. Node 24 is
required. The plan of work is the [roadmap](../decisions/roadmap.md),
and the deliberately postponed topics are in
[deferred](../decisions/deferred.md).
