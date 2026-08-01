# @nestling/contracts

The single physical home of Nestling's **direction-neutral declarations**:
`makeContract`, `defineFail` with the kernel failure codes, `Ok`/`Fail` and
the status vocabulary, io forms (`stream()`, `events()`, `multipart()`/
`upload()`), the placement marks `query()`/`body()` and the flat HTTP bind
map.

> 🚧 Active development, API may change. Design:
> [`docs/design/contracts.md`](../../docs/design/contracts.md).
> Guide: [`docs/guides/typed-client.md`](../../docs/guides/typed-client.md).

## Zero runtime dependencies — as an invariant, not a promise

The import closure of this package contains **no server code**: no
`@nestling/pipeline`, no `@nestling/app`, no transports, no `@nestling/config`,
no `node:*` — and no third-party runtime dependency at all (transitively only
the types of `@standard-schema/spec`). The injection-token primitive comes in
through the subpath `@nestling/container/tokens`, which exports two leaf
modules with no runtime imports of their own.

That is what makes a contract importable into a browser bundle, and it is
checked by a test (`src/boundary.spec.ts`) that walks the import closure of
the built `dist/` and fails naming the module and the forbidden import.
Tree-shaking is a property of the consumer's bundler, not ours.

```typescript
import { defineFail, makeContract, query } from '@nestling/contracts';

export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const CreateUser = makeContract({
  name: 'users.create',                                   // bus subject
  kind: 'request',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
});
```

The `http:` section is **addressing data**, not a description of execution:
a contract accepts nothing about handling a request (`handle`, `pipeline`,
`deps`, `detached`). The bind map is expanded at `makeContract` time, by the
same code that serves an HTTP declaration — so every consumer (the transport,
the OpenAPI generator, the typed client) reads one map from one import.

## Where the pieces are consumed

| Consumer | What it takes |
|---|---|
| [`@nestling/client`](../nestling.client) | the bind map, `output` schema and `errors:` — builds the request, validates the response, rematerializes failures |
| [`@nestling/transport.http`](../nestling.transport.http) | the same map — parses the request into a payload; re-exports `query()`/`body()` |
| [`@nestling/ports`](../nestling.ports) | `.port`/`.emitter`, `implement`, the bus |
| [`@nestling/pipeline`](../nestling.pipeline) | re-exports `Ok`/`Fail`, `defineFail`, the io forms — the working vocabulary of any handler |

`@nestling/ports` deliberately does **not** re-export `makeContract`: that
re-export would put the contract declaration back into a package with server
dependencies. The canonical import is `@nestling/contracts`.

## Two copies of this package mean two registries

The package keeps module state: the memoized members of the invoker token
families and the private `name → contract` registry. Two copies in one
application (a duplicated dependency, a mismatched version range) give two
registries and two token identities — a contract declared through one copy
will not be recognized by the other. The duplicate-name error says so
explicitly. In a monorepo the workspace protocol removes the risk; outside
one, keep the package a single resolved version.
