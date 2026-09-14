# 6. Where the handler gets the repository from

> Guide to the current API; verified against `7e698779`.
> Target description: [design/container.md](../design/container.md),
> [design/endpoints.md](../design/endpoints.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-06] Token families + модули без рантайм-инкапсуляции` and
> `[2026-09-03] Поле handler: зависимости принадлежат хендлеру; канон return; Output<T, typeof Def>`.

Users must be stored in one place, not in the file of every endpoint. The
handlers need a repository, the repository needs a database connection. The
connection must open at start and close at stop, and an endpoint must not
build all of this by hand.

```typescript
// src/users/users.repository.ts
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');
```

A DI token is the key by which a dependency is requested from the container. A
class serves as its own DI token, so `makeToken` is needed only where a
dependency is described by an interface. The `$` suffix tells a DI token apart
from an interface of the same name. The kernel's DI tokens are named the same
way, for example `HttpTransport$`.

```typescript
// src/users/users.repository.ts
/** The user store: everything the endpoints need from the database */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: Omit<User, 'id'>): Promise<User>;
  patch(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
}
```

The interface describes what the consumer needs, not what the database can do.
`insert` takes `Omit<User, 'id'>`: the store issues the identifier, and it must
not be in the argument. The handlers depend on `UsersRepository$`, not on the
class, so the implementation can be swapped without touching the endpoints —
this is what the test uses when it calls the handler with a fake instead of the
database.

## The handler and the repository as dependencies

```typescript
// src/users/endpoints/get-user.endpoint.ts
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

export const GetUser = httpEndpoint.get('/users/:id', {
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  handler: GetUserHandler,
});
```

`@Handler([UsersRepository$])` declares the role of the class and lists its
dependencies as an explicit list of DI tokens. The order of the list matches
the order of the constructor arguments, and the type of the argument is checked
against the type of the DI token: you cannot put an argument of another type
into the constructor.

The decorator here is standard, from ECMAScript. The list of DI tokens is
written as a value, so neither the package nor the application needs
`reflect-metadata` or `emitDecoratorMetadata`.

The compiler checks the types, the order and the length. An argument of another
type, a mixed-up order of DI tokens, a list shorter or a list longer than the
list of parameters all give a compilation error. A constructor with an optional
parameter allows both lengths, a constructor with a rest parameter allows any
length.

The linter suggests the list. The `dependency-list` rule from
`@nestlingjs/eslint-plugin` derives the expected DI tokens from the types of
the parameters: `UsersRepository$` for the `UsersRepository` interface and
`Logger$.auto` for `Logger`, when these DI tokens are visible in the file,
`AppConfig` for `Config<typeof AppConfig>`, the class itself for a class. Write
`@Handler()` with an empty list, and `eslint --fix` fills it with the names the
file already imports. A type the rule does not know, it accepts as written, so
the rule's level is `warn`. The guarantee comes from the compiler.
[Chapter 10](./10-auth.md) shows how to connect the plugin.

Nothing about dependencies is written in the declaration: it names the address,
the schemas, the failures and the pipeline. The container creates the handler
instance with ready dependencies, as in chapter 5.

The implementation of the repository is declared the same way:

```typescript
// src/users/users.repository.ts
@Component([db.connection, Logger$.auto, Ctx(RequestId)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ? toUser(row) : null;
  }

  // …
}
```

`db.connection` is the DI token of the PostgreSQL connection. The
`@nestlingjs/drizzle.pg` package declares the connection with one call to
`makeDrizzlePg({ schema })`. How this works, and why a mutating method writes
through the request's transaction rather than through a connection from the
pool, is shown by [chapter 11](./11-database.md).

The decorator names the **role** of the class, not its capacity to be a
dependency. There are three roles. `@Component` is an ordinary class,
`@Resource` is something that must be acquired and released, and `@Handler` is
a class with a `handle` method. The compiler checks the shape of the class: a
`handle` method on a component and a `static acquire` on a handler do not
compile.

The decorator does not accept a DI token: the class is registered under its own
name. To make the container give `DbUsersRepository` to whoever requested
`UsersRepository$`, the binding is written in the `providers:` of the feature:
`classProvider(UsersRepository$, DbUsersRepository)`. The name of the
implementation says how it is implemented: `DbUsersRepository` for the
database, `inMemoryUsersRepo` for the fake
([conventions.md](../conventions.md)). The `Ctx(RequestId)` dependency reads
the request identifier from the context.

The feature lists the providers that the container creates — the services and
the pipeline step classes:

```typescript
// src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    classProvider(UsersRepository$, DbUsersRepository),
    AuditOutcome,
    Authenticate,
  ],
  endpoints: [
    ListUsers,
    GetUser,
    CreateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
  ],
});
```

There are no handler classes here: the endpoints register them themselves.

## A dependency of a dependency, and resources

The repository needs the database, the database needs the configuration and the
logger. No consumer builds any of this: the container builds the whole graph
and checks the whole of it at start. A DI token without a provider stops the
build with a list of all the missing DI tokens, and a dependency cycle stops
it too. While requests are being processed, the container resolves nothing.

The database holds a connection pool, and the pool must be opened and closed.
This is exactly the role of `@Resource`:

```typescript
// the shape of the role; the example's connection is declared by @nestlingjs/drizzle.pg
@Resource([AppConfig, Logger$.auto])
export class SearchIndex {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    signal: AbortSignal,
  ): Promise<SearchIndex> {
    const client = await connect(config.searchUrl, { signal });
    logger.info('search index connected');

    return new SearchIndex(logger, client);
  }

  private constructor(
    private readonly logger: Logger,
    private readonly client: SearchClient,
  ) {}

  async release(): Promise<void> {
    await this.client.close();
    this.logger.info('search index disconnected');
  }
}
```

`static acquire` creates the instance, not the constructor: the acquisition is
asynchronous and can fail, and the constructor can do neither. The dependencies
arrive in `acquire` in the order of the list, with the last argument being the
start-abort signal: if the process is wound down during the acquisition, the
connection can be left unopened. `release` is called at stop, in the order
reverse to the acquisition.

From this follows the main property: the consumer of a resource is created
**after** the acquisition and gets a ready value. So the field has neither
`| undefined` nor a getter with a check: it has no "not connected yet" state
at all.

The database connection in the example is declared with exactly this role, but
not in the application code: `makeDrizzlePg({ schema })` creates the resource
inside itself and gives out a DI token. The application puts the value in
`plugins:` and gives the pool no further thought.

## Providers without a class

Not every node of the graph is a class. A ready value and the result of a
factory are registered by providers:

```typescript
providers: [
  valueProvider(FeatureFlags$, { newSearch: true }),
  factoryProvider(
    SearchClient$,
    (config: Config<typeof AppConfig>) => new SearchClient(config.searchUrl),
    [AppConfig],
  ),
]
```

`valueProvider(token, value)` registers a ready value,
`factoryProvider(token, factory, deps)` registers the result of calling a
factory with dependencies. The factory's own dependencies are listed as the
third argument: the container creates them and passes them in the same order.
The dependency lists are typed: an argument of another type than the DI token
in the same position does not compile, both for the factory's `deps` and for
the role decorator. The connection of a third-party library is declared with
`resourceProvider(token, { deps, acquire, release })`: the same pair of
acquisition and release, only without a class. Here you can inject only a DI
token that could be imported: the encapsulation rests on ES module exports, not
on a runtime mechanism.

The handler is created with a fake of the repository, without a container and
without a transport:

```typescript
// src/users/endpoints/create-user.endpoint.spec.ts
const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

const result = await handler.handle({ name: 'Carol', email: 'carol@example.com' });

expect(result).toMatchObject({
  status: 'created',
  value: { id: '2', name: 'Carol' },
});
```

```bash
API_TOKEN=secret yarn start:dev
curl localhost:3000/users/1
```

The database address and the Bearer token come from the environment, not from
the code. Next chapter:
[7. The port and the database address from the environment](./07-config.md).

