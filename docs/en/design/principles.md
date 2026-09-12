# The guiding principles

> **Target state of V1.** The principles are cross-cutting: journal
> entries ([ideas.md](../../decisions/ideas.md)) sit next to the
> mechanisms that implement them. Implementation status:
> [roadmap](../../decisions/roadmap.md).

Nestling is a TypeScript framework: smaller, more modern and
architecturally better than NestJS. The principles below are the
criteria a decision is checked against. Each one comes with the
framework mechanism where it shows up.

## No runtime magic

Everything a build can decide, a build decides. Dependencies are
declared as an explicit array of DI tokens; the framework uses neither
`reflect-metadata` nor `emitDecoratorMetadata` nor an inject-by-type
mechanism. The container is eager: `build()` checks the whole graph, the
INIT phase creates every instance, and both steps finish before the
first request, so a cycle or a missing dependency is a startup error,
not a request-time error. Needs that look dynamic — a provider with a
parameter, multi-injection, a composition chosen by a value from the
environment — are expressed statically, through DI token families and
composition switches: the builder sees every requested family member
and every branch before start. Nothing resolves while the application
runs: a port is bound to a local implementation or to a remote client at
assembly, not on every call.

## Guarantee over convention

An important invariant rests on the shape of the API, not on team
discipline: the code that would break it cannot be written. Examples:

- a transport cannot start accepting requests before routing is ready:
  it has no argument-less `listen()`, only `serve(dispatch, signal)`;
  `dispatch` is created on the WIRE phase, and the socket opens last, on
  START ([composition.md](./composition.md));
- the consumer of a resource cannot get an unacquired resource: it is
  created after `acquire` ([container.md](./container.md));
- a handler class cannot be written into `providers:`, and a component
  cannot go into the `handler:` slot: the compiler checks the role of
  the class ([container.md](./container.md));
- a handler with HTTP metadata cannot be attached to an operation:
  `implement` accepts only a handler that does not depend on the
  transport ([endpoints.md](./endpoints.md));
- the response of an endpoint is a closed set: an undeclared failure on
  the way out is replaced by `InternalError`, not passed through with a
  warning ([errors.md](./errors.md));
- an input field is accepted from exactly one place of the HTTP request;
  there is no merging "from everywhere" ([endpoints.md](./endpoints.md));
- a stub of an operation cannot drift from reality: the responses of
  `stub(Operation)` are checked against the schema of the operation
  ([testing.md](./testing.md)).

## Explicit over implicit

Everything that affects an endpoint is visible in its declaration. The
pipeline is composed of constants; it has no application level and no
module level. The consumer names the methods of a client (an object
passed to `makeClient`), not a string parser. `process.env` is read in
one place, the kernel; the only exception is the assembly argument (the
feature selection and the switches), read before the container is
assembled. Nestling has no notion of middleware: pipeline units do not
wrap each other and do not call `next()`.

## Schema-first

Schemas describe what travels over the network. Validation, the types
of the handler, typed clients, OpenAPI and AsyncAPI are all derived from
the `input`, `output` and `errors` declarations. The framework accepts
Standard Schema (`StandardSchemaV1`) at every boundary; the user picks
the validator (zod, valibot, arktype), and the documentation examples
use zod. Consequence for the pipeline: the response phase does not
change the type of the value, or the `output` schema would stop
describing the actual response.

## Values, not bytes

The pipeline and the handler work with abstract values. Everything
byte-level — compression, CORS, content negotiation, multipart parsing
— is done by the transport ([transports.md](./transports.md)). Stream
boundaries are the standard `AsyncIterable` with pull backpressure, not
a library type ([streaming.md](./streaming.md)). RxJS is a tool for the
handler, not for the kernel.

## Visibility through ES modules

Encapsulation rests on the visibility of language modules, not on a
runtime mechanism: only a DI token that could be imported can be
injected. Code that uses a DI token that was not exported cannot be
written. This is what the boundary between the kernel and user code
rests on (the kernel's implementations are not exported), and the
permission model of the configuration too: a private DI token grants
the right to read a section, and the exported `.keys` grants the right
to bind a source to it.

## Declarations are values

A module, a feature, an endpoint, an operation, a pipeline are ordinary
values. This is why, with no extra code: parametrization is a function
instead of `forRoot` and `DynamicModule`, a subset of features is chosen
by filtering an array, pipelines are composed from constants and
checked by the compiler, tests get `overrides`, and introspection
(`explain()`, a graph visualization) is possible. Classes remain where
they connect to the container: components, resources, units, handlers.
This is a form of DI registration, not a style of declaration; the
canonical style of declaration is the `make*` functions.

## Progressive disclosure

While there is one feature, the notion of a feature does not exist: the
endpoints and the providers sit in the root. Levels L0 through L4 (the
endpoints in the root, the configuration, the features with `select`,
the ports, a split deployment) are additive: the code of the endpoints
and the providers does not change when an upper level is connected, only
the composition root changes, and an unused level costs nothing, neither
in the API nor in the concepts ([composition.md](./composition.md)).
Between a single process and a split deployment, only the composition
root and the configuration change; the code of the features stays the
same.

## Kernel boundary

The kernel (the `@nestlingjs/*` packages) does not depend on storage or
external infrastructure. Everything that needs storage or an external
system — deduplication by an idempotency key, an outbox and a relay, a
subscription registry, dashboards — lives in satellite packages on top
of public primitives: DI, `AbortSignal`, the hooks of request
completion, `Topic`. The criterion for the boundary is dogfooding: a
satellite is written without touching the kernel. When it cannot be
written this way, a public primitive is missing, and that is what gets
fixed (entry [ideas.md](../../decisions/ideas.md)
`[2026-07-14] Kernel 1.0 — граница ядра`).

The criterion was checked on the subscription registry
`@nestlingjs/subscriptions` ([streaming.md](./streaming.md) §4.1, the
recipe [Who is connected right now and how to disconnect
them](../recipes/ops.md)): the package
is written entirely on top of public primitives, with no changes to the
kernel and no external dependencies. What it ran into at the boundary is
described in [ideas.md](../../decisions/ideas.md)
`[2026-08-01] Реестр подписок: результат dogfooding-замера`.
