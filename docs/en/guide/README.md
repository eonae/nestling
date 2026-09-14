# The Nestling guide

The guide leads from the first service to an application of several
features deployed in several processes. Every chapter starts with a task
you were going to solve anyway and opens exactly those capabilities of the
framework without which the task cannot be solved. Capabilities the task
does not need yet are not named at all: a concept appears where it is
explained, not earlier.

If you have written NestJS, start with [«From NestJS»](../from-nestjs.md).
It names line by line what in Nestling writes down what you did in Nest.

The reader of the guide knows TypeScript and has written services on Nest
or Express. The terms come from the [glossary](../glossary.md). The target
description of every subsystem lies in [`design/`](../design/README.md),
and the reasons for the decisions in
[`decisions/ideas.md`](../../decisions/ideas.md); the chapters refer to
them in the plate.

## How to read

Read both parts in order: the chapters build one application, and each one
rests on the code of the previous one. The naming rules the examples
follow are collected in [conventions.md](../conventions.md).

The tasks that come up outside this order are moved into
[recipes](../recipes/README.md): every recipe is self-contained and is
read when needed. The list of what the framework checks before the first
request lies in a separate reference, [guarantees.md](../guarantees.md).

The code of the chapters is written for the text: a snippet starts with a
path inside your project and reads on the spot. The applications built
in full lie in [`examples/`](../../../examples/) — a chapter links to them
where that helps, but it does not retell their code.

## Concept map

The table names a concept, one sentence about it and the chapter that
introduces it. It holds the concepts of the path; the concepts a recipe
introduces are not in the map — the map describes the reading order.

| Concept | One sentence | Chapter |
|---|---|---|
| endpoint | What the application serves at an address: an HTTP route, a CLI command, an implementation of an operation | [1](./01-first-service.md) |
| application declaration (`makeApp`) | A value with the composition of the application: the endpoints of the root or the features, plugins, switches, transports, policies, configuration binding | [1](./01-first-service.md) |
| transport | A node of the graph that accepts requests from the outside and passes them into `dispatch` | [1](./01-first-service.md) |
| root composition shape | One of the three records of `makeApp`: `{ endpoints, providers? }`, `{ endpoints, modules? }` or `{ features }` | [2](./02-composition.md) |
| feature | A unit of the application with its own endpoints that can be moved into a separate process | [2](./02-composition.md) |
| build argument | What this process builds: the feature selection and the values of the switches | [2](./02-composition.md) |
| schema (Standard Schema) | Any value that implements Standard Schema v1: zod, valibot, arktype | [3](./03-input.md) |
| failure, `Fail` | An error that the endpoint declared in `errors:` and the handler returns as a value | [4](./04-errors.md) |
| handler | A function or a class with a `handle` method that receives the checked input and returns `Ok` or `Fail` | [5](./05-handler-class.md) |
| DI token | The key by which a dependency is requested from the container | [6](./06-repository.md) |
| provider | A description of how to obtain the value for a DI token | [6](./06-repository.md) |
| section (of the configuration) | An object «field → schema» that is injected as an ordinary dependency | [7](./07-config.md) |
| pipeline | The sequence of steps around the handler: `.pre` before it, `.ok` and `.catch` after it, `.finally` at the end | [9](./09-logging.md) |
| step | One function or class in the pipeline | [9](./09-logging.md) |
| layer (of a pipeline) | One `makePipeline()` call with a chain of methods that `compose` puts together with the others | [9](./09-logging.md) |
| context (`ctx`) | The typed object of the request that `.pre` steps extend and the handler and the other steps read | [9](./09-logging.md) |
| kernel logger | The `Logger` interface, the root `RootLogger$` and the family `Logger$` with `.auto`: both the kernel and the application write through it | [9](./09-logging.md) |
| trace | The chain of processing of one request across every process it touched; `withTracing()` puts it into the context | [9](./09-logging.md) |
| policy | An invariant over the built graph that is checked on the BUILD phase | [10](./10-auth.md) |
| early success | The third outcome of a pre-step: `done()` finishes the endpoint with a success without reaching the handler | [10](./10-auth.md) |
| HTTP shape of a handler | A handler whose `meta` contains the request and whose result allows an `HttpResponse`: headers, cookies and a redirect | [10](./10-auth.md) |
| transport start context | The fields the transport puts into the context before the first `.pre` step; for HTTP it is `HttpStartContext` | [10](./10-auth.md) |
| database connection | The value `makeDrizzlePg({ schema })`: the DI token of the pool, the transaction variable, the layer and the policy in one declaration | [11](./11-database.md) |
| request transaction | The context variable that the pipeline layer puts there: the repository and the transactional emitter read it with the `Ctx` reader | [11](./11-database.md) |
| io shape | The kind of input or output of an endpoint: `value`, `stream(T)`, `events(T)`, `multipart()`, `upload()` | [12](./12-files-and-streams.md) |
| operation | The unit of communication between features: a name, the `input` and `output` schemas, the list of `errors` | [14](./14-features.md) |
| implementation (of an operation) | The endpoint that serves the operation | [14](./14-features.md) |
| caller, emitter | The objects for calling an operation: `caller.call` for a request, `emitter.emit` for a command and an event | [14](./14-features.md) |
| plugin | Cross-cutting infrastructure that is present in every process and is available by DI tokens | [2](./02-composition.md) |
| module | A `makeModule` object that groups providers under a name | [2](./02-composition.md) |
| subscriber | The name under which a feature subscribes to an event | [15](./15-events.md) |
| inbox mark | The record «this consumer has processed this message», committed by the request transaction | [16](./16-durable-events.md) |
| feature selection | Which features to include in the build: `'all'`, a list of names or the `features` field of the argument | [19](./19-select.md) |
| composition switch | A value that chooses one of the declared composition branches by a value known before build | [19](./19-select.md) |
| composition branch | The elements that go into the list at one of the values of a switch: `Storage.pick({ … })`, `AuditEnabled.when(…)` | [19](./19-select.md) |
| intercom | The role of the carrier of operations between processes, assigned to a declared transport | [20](./20-split.md) |
| split deployment | The features of one application are started in different processes and talk through a broker | [20](./20-split.md) |
| metric | A number that the application or the kernel writes by name with attributes: a counter or a histogram | [22](./22-metrics.md) |

## Part 1. The service

| Chapter | Task |
|---|---|
| [1. Bring up a service that answers a request](./01-first-service.md) | an endpoint, `makeApp`, the `http()` transport |
| [2. What an application consists of](./02-composition.md) | the three root shapes, providers, modules, features, switches, the build argument |
| [3. Accept data and let no rubbish through](./03-input.md) | the `input` schema, path and query, `bind`, the `400` response |
| [4. Tell the client what went wrong](./04-errors.md) | `makeFail`, a code with a category, `errors:`, `Ok.created` |
| [5. A handler as a class](./05-handler-class.md) | the `handler` field, `@Handler`, a unit test through `new` |
| [6. Where the handler gets the repository from](./06-repository.md) | the DI token of an interface, `providers`, class roles, resources, value providers |
| [7. The port and the database address from the environment](./07-config.md) | `makeConfig`, keys, `secret`, fail-fast |
| [8. Make sure it works without starting a server](./08-testing.md) | `buildTest(app, …)`, `overrides`, `vars`, a unit test of a handler |
| [9. See every request in the log](./09-logging.md) | the pipeline `.pre` and `.finally`, a layer, `compose`, `Ctx(RequestId)` |
| [10. Let only your own through](./10-auth.md) | a pre-step with a failure, the context of a layer, the `hasLayer` and `hasVar` policies, `detached`, `HttpResponse` and transport steps |
| [11. Write to the database in the request transaction](./11-database.md) | `makeDrizzlePg`, a transaction in a context variable, drizzle-kit migrations |
| [12. Files and large exports](./12-files-and-streams.md) | `multipart`, `upload`, `stream(T)` on the input and on the output |
| [13. Give the frontend the documentation and the client](./13-openapi-and-client.md) | `makeOpenapi()`, `doc:`, an operation with `http:`, `makeClient` |

## Part 2. The application

| Chapter | Task |
|---|---|
| [14. Separate the second area](./14-features.md) | the feature boundary, the `request` operation, `implement`, `.caller`, plugins, modules |
| [15. Tell the neighbours what happened](./15-events.md) | `event`, `command`, `subscriber`, the idempotency key |
| [16. Do not lose an event when the process falls](./16-durable-events.md) | `outboxed(Op)`, the relay, the inbox mark, the early success of a subscriber |
| [17. A live feed for the client](./17-live-feed.md) | `events(T)`, `sse:`, `Topic`, `AbortSignal` |
| [18. Test a feature without its neighbours](./18-testing-features.md) | `stubs`, `testApp.emit`, `contextValue`, `checkTopologies` |
| [19. Start only a part of the features](./19-select.md) | `build(args)`, `argv(process.argv)`, `includeDeps`, composition switches, `check()` |
| [20. Spread the features across processes](./20-split.md) | `nats()`, `intercom`, `durable`, `propagate` |
| [21. Do not break the neighbours when an operation changes](./21-compatibility.md) | the version in the name, the snapshot of operations, `diffOperations` |
| [22. Count requests and calls between processes](./22-metrics.md) | `Metrics`, the `metrics` option, `Metrics$.auto`, kernel metrics, the adapter and `/metrics` |
