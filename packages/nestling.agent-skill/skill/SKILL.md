---
name: nestling
description: How to write application code for Nestling, a TypeScript backend framework where declarations are plain values, dependencies are listed explicitly and failures are returned instead of thrown. Use when writing or reviewing code that imports @nestlingjs/*, when explaining a compile-time or assemble-time error from a Nestling application, or when porting a service from NestJS.
---

# Nestling

Nestling reads like NestJS from a distance and differs everywhere it
matters. Habits from Nest produce code here that either does not compile or
stops the ASSEMBLE phase. Read parts 1 and 4 before writing anything; the
rest is reference.

## What is different from NestJS

- **A declaration is a value.** An endpoint, a module, a feature, a config
  section, an operation and a failure are all objects returned by a
  function — `httpEndpoint({ … })`, `makeModule({ … })`, `makeFail(…)`.
  There is no decorator that registers anything and no metadata to reflect
  over. The value goes into a list of some other declaration, or it takes
  no part in the application.
- **Dependencies are an explicit list.** A class declares its DI tokens in
  the decorator argument: `@Component([Database, Logger$.auto])`. The list
  must match the constructor parameters by type, by order and by length.
  `emitDecoratorMetadata` and `reflect-metadata` are not used.
- **A failure is a value, not an exception.** The handler returns
  `UserNotFound({ id })`, and the endpoint declares that failure in
  `errors:`. A thrown error is a bug, not a response: it becomes
  `internal_error`.
- **Features talk through operations.** A feature never injects a service
  of another feature. It calls an operation through `Operation.caller` or
  emits an event through `Operation.emitter`; the answer is `Ok | Fail`
  even inside one process. A direct edge between features is an assembly
  error.
- **The whole graph is checked before the first request.** Config sections
  are read, the container is built, endpoints are discovered and the
  declared policies are run — all before a socket is open. Provider
  factories are synchronous and do no I/O; a connection is a `@Resource`
  opened on the INIT phase.

## Service skeleton

One endpoint per file, one folder per feature. Names come from the
framework conventions, and the linter and the guide follow them.

```
src/
├── main.ts                — reads the root config and runs `app.assemble(…).run()`
├── app.ts                 — `makeApp({ features, plugins, transports, policies })`
├── app.config.ts          — `makeConfig('app', { … })`
├── errors.ts              — failures shared by the whole service
├── operations.ts          — operations between features
├── api/operations.ts      — operations the HTTP client imports too
└── users/                 — one folder per feature
    ├── users.feature.ts   — `makeFeature({ … })` and the `makeModule` of this feature
    ├── users.repository.ts — interface, `UsersRepository$` token, `@Component` class
    ├── users.errors.ts    — failures of this feature
    └── endpoints/
        └── get-user.endpoint.ts — one endpoint, `GetUser`, `GetUserHandler`
```

- An endpoint and its operation share the name: a verb with an object in
  PascalCase — `GetUser`, `CreateUser`. The file is the same name in
  kebab case with the suffix `.endpoint.ts`.
- The `name` of an operation is the feature and the verb, lower case:
  `users.get`, `quotas.claim`.
- A DI token for an interface takes the suffix `$`: `UsersRepository$`,
  `Logger$`. A class is its own token and needs no separate name.
- A handler class is named after the operation with the suffix `Handler`
  and its method is always `handle`.
- A failure is named after the event without any suffix — `UserNotFound`,
  `EmailTaken` — and its code is `category[:refinement]`.

## A minimal application

Three packages make the core (`@nestlingjs/app`, `@nestlingjs/container`,
`@nestlingjs/operations`) and a transport is chosen separately. Relative
imports carry the `.js` extension: the output is loaded by Node as ESM.

<!-- snippet: minimal-app.ts -->
```typescript
import type { Output } from '@nestlingjs/app';
import { makeApp, makeFeature } from '@nestlingjs/app';
import { makeFail } from '@nestlingjs/operations';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const User = z.object({ id: z.string(), name: z.string() });

type User = z.infer<typeof User>;

/** A failure is a value with a machine-readable code, not an exception class */
const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

const users = new Map<string, User>([['1', { id: '1', name: 'Alice' }]]);

/** An endpoint is a value: address, schemas, declared failures, handler */
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  handler: async ({ id }): Output<User, typeof UserNotFound> =>
    users.get(id) ?? UserNotFound({ id }),
});

/** A feature owns endpoints and providers. An app is a list of features */
const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

// `assemble()` picks what this process runs; `run()` builds the graph,
// walks the phases, opens the socket and stops on SIGTERM
await makeApp({ features: [UsersFeature], transports: [http()] })
  .assemble()
  .run();
```

## Rules the compiler or ASSEMBLE catches

1. **The dependency list matches the constructor.**
   `@Component([Database, Logger$.auto])` next to
   `constructor(db: Database, logger: Logger)`. A wrong order, a wrong
   length or a missing token is a compile error; a token nobody provides
   stops `assemble()`. `@Injectable()` does not exist.
2. **A failure is returned, never thrown.** `return UserNotFound({ id })`,
   and `UserNotFound` is listed in `errors:` of the endpoint or of its
   operation. `throw new NotFoundException()` has no equivalent: a thrown
   error is reported as `internal_error`, and a failure outside `errors:`
   is replaced by `internal_error` as well.
3. **A neighbouring feature is reached through an operation.** Inject
   `ClaimQuota.caller` and `await port.call(input)`, or
   `UserRegistered.emitter` and `await emitter.emit(input)`. Injecting
   `QuotaService` from another feature is an assembly error, and it would
   also make the two features impossible to deploy apart.
4. **Assembly is synchronous.** A provider factory returns a value and does
   no I/O; anything that opens a connection is a `@Resource` with
   `static acquire` and `release`. Config sources are read before the
   container is built, so `process.env` is never read from a factory.
5. **An endpoint is a value, not a controller.** `httpEndpoint({ method,
   path, input, output, errors, handler })`, exported from its file and
   listed in `endpoints:` of a feature. There is no `@Controller`, no
   `@Get`, no `@Body`, and no separate controller layer: the handler is a
   function, or a class marked `@Handler([…])` with a `handle` method.
6. **A policy in the root obliges every endpoint.** When `makeApp` declares
   `everyEndpoint(…).hasLayer(observability)`, every endpoint it selects
   names that layer in `pipeline:` — the operation form and `implement`
   included, where it is often the only field they add — or opts out with
   `detached: '<reason>'`. ASSEMBLE names the ones that did neither and
   stops the process before a socket is open.
7. **A redirect is declared, not only returned.** `redirect: 302` in the
   declaration and `HttpResponse.redirect(url)` in the handler. Without the
   field the answer is `internal_error`: the declaration is what the
   transport and the OpenAPI document read, and nothing catches the
   mismatch at compile time.

## Where to look next

| Need | Read |
|---|---|
| set up `tsconfig.json`, the scripts, the runner and the linter | `references/setup.md` |
| declare an endpoint, place input fields, pick an io form | `references/endpoints.md` |
| set a success status, headers, cookies or a redirect | `references/http.md` |
| DI tokens, providers, class roles, modules, lifecycle phases | `references/container.md` |
| layers, `.pre` / `.ok` / `.catch` / `.finally`, context, policies | `references/pipeline.md` |
| define a failure, return it, read it, map it to a status | `references/errors.md` |
| config sections, secrets, derived fields, sources | `references/config.md` |
| features, operations, callers, emitters, subscribers, split | `references/features.md` |
| assemble an app in a test, override, stub, check topologies | `references/testing.md` |
| the NestJS name for a thing and its Nestling counterpart | `references/from-nest.md` |

Every reference points at the README of the package that owns the names it
mentions. Read that README for the full list of exports; the reference only
shows the shape of the code.

Beyond the core and a transport, the framework publishes six more packages.
Take one when its line describes the problem at hand:

| Package | When you need it |
|---|---|
| `@nestlingjs/outbox` | an event must leave even if the process dies right after the commit: the record goes into the transaction that changed the data, and the send happens after it. The first thing asked for once a service has both a database and a bus |
| `@nestlingjs/client` | a browser or another service calls these operations: `makeClient(record, config)` turns the declarations into a typed API. The other first request, and the reason an operation file imports nothing but schemas |
| `@nestlingjs/subscriptions` | streams and SSE are open and someone has to list them, close one, or watch the list change |
| `@nestlingjs/models` | the TypeScript type exists already — generated from proto, GraphQL or OpenAPI — and a schema has to describe exactly it |
| `@nestlingjs/transport.cli` | the same endpoints and layers are wanted as commands, with stdin as the stream |
| `@nestlingjs/eslint-plugin` | the two rules an editor can check: an import past a barrel, and a declaration without the required layer |
