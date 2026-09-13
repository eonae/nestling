# 2. What an application consists of

> Guide to the current API; verified against `771744f7`.
> Target description: [design/composition.md](../design/composition.md). Why:
> entries [ideas.md](../../decisions/ideas.md)
> `[2026-09-02] Модель композиции: фича, плагин, операция`,
> `[2026-09-03] Декларация приложения: makeApp, assemble(select), AssembledApp`
> and
> `[2026-09-06] Переключатели состава: makeSwitch, pick и when, аргумент сборки; формы корня без фич`.

Chapter 1 put together a service from one file. From here the application
grows, and it grows by one scheme: endpoints, providers, modules, features,
switches. This chapter names all five concepts at once, so that later chapters
introduce each of them as already known. It adds no code: the following
chapters return to the service of chapter 1 and take only the words from
here.

## The root: what the application is

The root is declared by `makeApp` and answers one question: what this
application consists of. The composition is described by exactly one of three
shapes:

```typescript
// a flat layer of providers
makeApp({ endpoints: [ListUsers], providers: [UsersRepository] });

// the same composition, already split into modules
makeApp({ endpoints: [ListUsers], modules: [UsersModule] });

// several named units
makeApp({ features: [UsersFeature, NotificationsFeature] });
```

Mixing the shapes is not allowed, and the type checks it: `endpoints:` next to
`features:` does not compile. The first two shapes are the composition of one
feature without a name: its endpoints and providers get the `app` label. A
service with several routes needs nothing more, and `makeFeature` never appears
in it.

## Providers: what lives in the graph

A provider describes how to obtain the value for a DI token: a class with a
role, a ready value, a factory or a resource. The container creates the
instances, not the application code. In detail:
[6. Where the handler gets the repository from](./06-repository.md).

## Modules: grouping providers under a name

A module is an object created by `makeModule({ name, providers, dependsOn })`.
It gives the container exactly one thing: a membership label on the nodes of
the graph. A module is not a boundary: visibility rests on ES module exports,
not on an `exports` list.

Modules are needed when there are many providers and you want to read the graph
in parts. An application with a dozen providers does not need them: a flat list
is shorter.

## Features: units of selection and boundaries

A feature is `makeFeature({ name, providers | modules, endpoints })`. It is a
unit of the application that may end up in another process, and every one of
its properties follows from that:

- a feature is addressed by **operations**, not by DI tokens: a DI token does
  not survive a process boundary, an operation does;
- a feature can be left out of the assembly, and then it is absent entirely: no
  providers in the graph, no endpoints in the transports;
- a feature has no `dependsOn` field: the link with its neighbours follows from
  the declared operations.

Cross-cutting infrastructure (logging, metrics, documentation) is not a
feature: it is present in every process by definition. It is declared by
`makePlugin` and listed in the root's `plugins:`. A plugin is addressed by DI
tokens. In detail: [14. Separate the second area](./14-features.md).

## Switches: the second dimension of the composition

The feature selection is one dimension of the composition: which areas this
process brings up. A switch is the second: which variant of the same area.

```typescript
import { makeSwitch } from '@nestlingjs/container';

export const Storage = makeSwitch('storage', ['s3', 'local']);

export const UploadsModule = makeModule({
  name: 'module:uploads',
  providers: [
    UploadsService,
    Storage.pick({ s3: [S3Client, S3Storage], local: [LocalStorage] }),
  ],
});
```

Both branches are listed as a table and are read without running code:
`check()` sees both of them, and so does a person. The root declares the
dictionary of switches, the value arrives as the assembly argument:

```typescript
export const app = makeApp({
  features: [UsersFeature, UploadsFeature],
  switches: [Storage],
  transports: [http()],
});

await app.assemble({ features: 'all', storage: 's3' }).run();
```

The choice cannot be injected: a switch has no DI token, and the composition
does not leak into the application code. In detail:
[19. Start only a part of the features](./19-select.md).

## The assembly argument: what this process assembles

The declaration says what the application is. The assembly argument says what a
specific process brings up from that. The shapes are `'all'`,
`'users,uploads'`, `['users', 'uploads']` or an object
`{ features?, includeDeps?, …switch values }`. The type of the object shape is
derived from `switches:`, so a typo in a switch name does not compile.

User code reads the argument, usually from a configuration section, before the
container:

```typescript
const cfg = load(RootConfig); // { features: 'all', storage: 's3' }

await app.assemble(cfg).run();
```

## Split: a consequence, not a separate mechanism

When features are spread across different processes, only the assembly argument
changes, along with the `intercom:` role of a declared transport. The code of
the features does not change: it already communicated by operations. In detail:
[20. Spread the features across processes](./20-split.md).

## One table

| Concept | What it declares | Where it is listed |
|---|---|---|
| endpoint | the address, the schemas, the handler | `endpoints:` of the root or a unit |
| provider | how to obtain the value for a DI token | `providers:` of the root, a unit or a module |
| module | the grouping of providers under a name | `modules:` of the root or a unit, `dependsOn:` of a module |
| feature | a unit of selection and a boundary | `features:` of the root |
| plugin | cross-cutting infrastructure | `plugins:` of the root |
| switch | the second dimension of the composition | `switches:` of the root |

Next, the service from chapter 1 learns to accept data from the client and
check it: [3. Accept data and let no rubbish through](./03-input.md).

