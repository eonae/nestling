# 5. A handler as a class

> Guide to the current API; verified against `86c47c0a`.
> Target description: [design/endpoints.md](../design/endpoints.md) §3. Why:
> entry [ideas.md](../../decisions/ideas.md)
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`.

The handlers from the previous chapters live as functions inside the dictionary
of the declaration. Such a handler is hard to test on its own: to call it, you
need to pull it out of the declaration. The handler needs to move into a
separate value that the test can see and that can later take dependencies.

```typescript
// src/users/endpoints/list-users.endpoint.ts
import type { Output } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

@Handler()
export class ListUsersHandler {
  async handle(input: ListUsersInput): Output<User[]> {
    return [alice, bob].slice(0, input.limit ?? 20);
  }
}

export const ListUsers = httpEndpoint.get('/users', {
  input: ListUsersInput,
  output: z.array(User),
  handler: ListUsersHandler,
});
```

The class declares a `handle` method with the same signature the function had:
the input data and an optional `meta`. The `@Handler()` decorator names the
role of the class, the handler of the declaration, and the empty list means it
has no dependencies. The role requires a `handle` method: a class without one
does not compile under `@Handler`.

The `handler` field accepts a class. `implements` is not needed: the
declaration's own constructor checks the `handle` signature against the `input`
and `output` schemas at the point of declaration. A handler that returns an
object of another shape does not compile on the `handler: ListUsersHandler`
line.

## The framework creates the instance

The endpoint registers the handler class itself: at build it adds a provider
of this class into the module of the unit that declared the endpoint. `new` is
not needed in the application code, the dependencies arrive in the constructor.
There is no need to list the class in the `providers:` of a feature:

```typescript
// src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    // the services of the feature; there are no handler classes here
  ],
  endpoints: [ListUsers, GetUser, CreateUser],
});
```

A class listed both in `handler` and in `providers:` stops the build at the
BUILD phase instead of giving two instances: a node of the graph has one
source. The message names the class, the pattern of the endpoint and the module
where the second registration was found.

The instance is created once, at the build of the application, and is reused
between requests — like an ordinary singleton of the container. You cannot
store the data of one request in a field: it will leak into the next one.
Everything that belongs to the request arrives as arguments of `handle`.

The class itself carries no endpoint metadata: the address, the schemas and the
failures live in the declaration. So the same class can be set as the handler
of two endpoints, and they will share one instance: the class serves as its own
DI token, and the provider is registered once.

## A unit test without the framework

A class is an ordinary value, so the test creates it with `new`:

```typescript
// src/users/endpoints/create-user.endpoint.spec.ts
import { CreateUserHandler } from './create-user.endpoint.js';

it('возвращает отказ EmailTaken для занятого email', async () => {
  const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

  const result = await handler.handle({ name: 'Alice II', email: alice.email });

  expect(EmailTaken.is(result)).toBe(true);
});
```

Such a test needs no container, no transport, no imports from
`@nestlingjs/app`. The constructor argument here is a fake of the store. A test
that calls the endpoint through the full pipeline checks the same class a
different way — through the declaration, not through `new`.

```bash
yarn test
```

## Two shapes of the `handler` field

A class is not the only shape. The `handler` field accepts two:

| Shape | Notation | When |
|---|---|---|
| function | `handler: async (input, meta) => …` | there are no dependencies, the handler is two lines |
| class | `handler: SomeHandler` | there are dependencies |

A class gets dependencies from the container, the same rule as for providers
and pipeline steps. A function remains for a handler that has nothing to
receive: a utility endpoint like `/ops/version`, and chapter one of this guide.
The choice of shape does not affect the behaviour of the endpoint.

There are no `deps` and `handle` fields at the top level of the declaration
dictionary: the dependencies belong to the handler, not to the address and the
schemas. Their presence is a compilation error.

The handler has become a class, but the data still lives in constants. The next
chapter connects the store:
[6. Where the handler gets the repository from](./06-repository.md).

