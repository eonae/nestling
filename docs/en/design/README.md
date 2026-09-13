# Target state of V1

This folder is the **full description of the target API and behaviour of
Nestling V1**, as if it were already implemented. It is the single place
where the target design is described as a whole; where it disagrees with
the code, this folder holds the intent and the code holds the current
fact.

The rules for keeping this folder live together with the rest of the
documentation rules in [docs/README.md](../../README.md), in its section
on keeping the documentation.

## Map

| Document | About |
|---|---|
| [principles.md](./principles.md) | the guiding principles and the cross-cutting boundaries |
| [container.md](./container.md) | DI: DI tokens, class roles (component, resource, handler), families, modules, the kernel logger, visibility |
| [composition.md](./composition.md) | the composition root: `makeApp`, `build(args)`, lifecycle phases, root shapes, features and `select`, switches, probes and the kernel logger, L0–L4 |
| [pipeline.md](./pipeline.md) | the request pipeline: phases, layers, `compose`, step shapes |
| [endpoints.md](./endpoints.md) | declarations: the operation comes first, per-transport constructors, io shapes, the HTTP canon |
| [operations.md](./operations.md) | operations and ports, the bus, dispatch policies, external clients |
| [config.md](./config.md) | configuration: sections, the keys capability, sources, reloadable, secrets |
| [errors.md](./errors.md) | the failure model: `Ok`/`Fail`, `makeFail`, codes with a category, `E ∪ InternalError` |
| [schemas.md](./schemas.md) | Standard Schema at the boundaries, OpenAPI and AsyncAPI through converters |
| [streaming.md](./streaming.md) | streaming: `stream` and `events`, item chains, `Topic`, the boundary with RxJS |
| [transports.md](./transports.md) | transports: `serve(dispatch)`, the server as a resource, transport steps, probes, the byte level (compression, CORS, parsing by the io declaration) |
| [persistence.md](./persistence.md) | the database: the connection as a value, the request transaction as a context variable, the storage adapters of the outbox and the inbox |
| [testing.md](./testing.md) | `@nestlingjs/testing`: `buildTest(app, …)`, stubs, `check(args)` |
