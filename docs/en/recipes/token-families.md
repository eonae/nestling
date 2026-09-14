# Dependencies by name and contributions collected from modules

> Guide to the current API; verified against `a2535b50`.
> Target description: [design/container.md](../design/container.md), the
> sections "DI token families" and "Kernel logger". Rationale: the entries
> [ideas.md](../../decisions/ideas.md)
> `Token families + модули без рантайм-инкапсуляции` [2026-07-06],
> `Multi-injection через token families: Family.all` [2026-07-10],
> `Логгер ядра: RootLogger$, семейство Logger$ с.auto и child` [2026-09-06] and
> `Пробы: HealthCheck$ и Health$ в ядре, транспорты адаптируют` [2026-09-06].

Services need counters: one counts calls, another counts database
queries. The counters are identical and differ only by name, and
registering a separate provider for each one is unwanted. A second task
from the same area: health checks are registered by different modules,
and one service collects them without knowing the list in advance.

A DI token family solves both tasks: one recipe for many dependencies
that differ by a parameter. The kernel logger from chapter
[9](../guide/09-logging.md) is built on the same mechanism.

## A family instead of a DI token

```typescript
// src/counters/registry.ts
import { makeTokenFamily } from '@nestlingjs/container';

/** A named counter: counts events of one kind */
export interface Counter {
  readonly name: string;
  readonly value: number;
  increment(): number;
}

export const Counter$ = makeTokenFamily<Counter, [name: string]>('Counter');
```

`makeTokenFamily<T, [param]>(id)` returns a family function. The call
`Counter$('users')` returns the DI token of a member with the identifier
`Counter:users`. A repeated call with the same parameter returns the
same DI token. A family member works everywhere an ordinary DI token
works: in a class's `deps`, in a factory's dependencies, in
`container.get()`. A DI token with the same name but created directly
through `makeToken('Counter:users')` is not a family member: the
container reports a missing provider, because membership in the family
is stored in a field of the DI token, not in the identifier string.

The interface is called `Counter`, the family `Counter$`, like the
interface's DI token from chapter [6](../guide/06-repository.md): the
family is called as a function, and the suffix tells it apart from the
interface in imports.

## A member as an ordinary dependency

```typescript
// src/users/users.service.ts (fragment)
@Component([UserRepository, Counter$('users'), Logger$('users')])
export class UserService {
  #repository: UserRepository;
  #calls: Counter;
  #logger: Logger;

  constructor(repository: UserRepository, calls: Counter, logger: Logger) {
    this.#repository = repository;
    this.#calls = calls;
    this.#logger = logger;
  }

  // …

  async getUsers(): Promise<string[]> {
    this.#calls.increment();

    return await this.#repository.findAll();
  }
}
```

The consumer names the member in `deps` and receives it in the
constructor. Neither registering a provider for `Counter$('users')` nor
a separate module is needed for this. Next to it stands
`Logger$('users')`, a member of the kernel logger family: the same
mechanism, only the recipe is registered by the kernel.

## One recipe for the whole family

```typescript
// src/counters/counters.plugin.ts (fragment)
export const counters = makePlugin({
  name: 'app-counters',
  providers: [
    // One recipe for the whole family: `name` is the parameter of the
    // requested member. The prefix is read from the config section,
    // like any dependency
    familyProvider(Counter$, (name) =>
      factoryProvider(
        Counter$(name),
        (config: Config<typeof AppConfig>) =>
          new InMemoryCounter(`${config.metricsPrefix}.${name}`),
        [AppConfig] as const,
      ),
    ),
  ],
});
```

`familyProvider(family, recipe)` registers the recipe. The recipe
receives the member's parameter and returns an ordinary provider
definition: `factoryProvider`, `classProvider` or `valueProvider`. The
provider from the recipe has its own `deps`: here the member depends on
the config section and reads the name prefix from it. The recipe lives
in the plugin because every module needs counters; plugins are
described in chapter [14](../guide/14-features.md).

At `build()`, the container takes four steps.

1. Collects the family members named in the `deps` of every registered
   provider.
2. Calls the recipe once for every unique parameter.
3. Registers the result as an ordinary provider.
4. Repeats while new members appear: a provider from the recipe may
   itself depend on members of the same family or another one.

From here on, the member is no different from a manually registered
provider. It becomes a node at build and a value at INIT. Two
consumers of `Counter$('users')` receive one instance: `UserService`
increments the counter, and `Demo` reads its value. The member takes
part in the cycle check, is created and released in topological order
along with the other nodes, and appears in `toJSON()` and the
visualization. A member nobody requested is not created:
`container.get(Counter$('orphan'))` returns `null`.

A member named in `deps` for which no recipe is registered stops the
build with the name of the family and the parameter. A recipe that
returns a provider for a different DI token also stops the build:
the error names the family, the parameter and the actual DI token. A
second recipe for the same family is a registration error.

## The member's name from the consumer: `.auto`

```typescript
// src/users/users.repository.ts
@Component([Database$, Logger$.auto])
export class UserRepository {
  #database: Database;
  #logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.#database = database;
    this.#logger = logger;
  }

  async findAll(): Promise<string[]> {
    this.#logger.info('Loading all users');

    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
```

`Logger$.auto` in the `deps` of the `UserRepository` class turns into
`Logger$('UserRepository')` at the moment of decoration. The name comes
from `constructor.name`, so nothing is computed at runtime. In the
example's output this is the line
`INFO  UserRepository Loading all users`: the member's scope stands in
every line. An explicit `Logger$('UserRepository')` and `.auto` in the
same class give one graph node. `.auto` exists on every family,
`Counter$.auto` included.

Three limits of `.auto`:

- it is allowed only in the `deps` of a class with a role decorator; a
  factory's dependencies have no consumer class, and this is a
  registration error with a hint to write an explicit family call;
- an anonymous class with an empty `constructor.name` gives an error at
  decoration;
- a minifier that renames classes renames the members too. The package
  is built for server-side Node without minification.

## Contributions from different modules: `.all`

The kernel declares the family of contributions to the probes:
`HealthCheck$(name)` from `@nestlingjs/app`. Declaring your own is not
needed: a contribution is written under a member of the kernel family,
and the probes node sees it.

A contribution is an ordinary class with the `HealthCheck` interface: a
critical flag and a check method. The member of the family sets the
check's name, so the class itself carries no name:

```typescript
// src/database/database.health.ts (fragment)
@Component([Database$, HealthConfig])
export class DatabaseHealthCheck implements HealthCheck {
  readonly critical = true;

  async check(_signal: AbortSignal): Promise<HealthStatus> {
    const rows = await this.#database.query('SELECT 1');

    return rows.length > 0 ? 'ok' : 'down';
  }
}
```

It is registered as an ordinary provider with the member's DI token, in
the module where it belongs:

```typescript
// src/database/database.module.ts
export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    classProvider(HealthCheck$('database'), DatabaseHealthCheck),
  ],
});
```

A second contribution lives in a different module, and the first
module needed no change for it:

```typescript
// src/api/api.module.ts (fragment)
classProvider(HealthCheck$('api'), ApiHealthCheck),
```

The kernel node `Health$` gives the whole state of the application: it
collects the outcomes of the contributions into a report, computes the
result by phase and criticality, and caches the run. An ordinary
application needs nothing more — the recipe [Who is connected right now
and how to disconnect them](./ops.md) shows the probes over HTTP.

But `.all` also works on the kernel family: a dependency on
`HealthCheck$.all` gives an array of every contribution, wherever it
was registered.

```typescript
// src/demo.ts (fragment)
@Component([Health$, HealthCheck$.all, /* … */])
export class Demo {
  constructor(
    private readonly health: Health,
    private readonly checks: readonly HealthCheck[],
    // …
  ) {}
}
```

`HealthCheck$.all` stands in `deps` next to the node and a member of
the logger family: the aggregate has no special status. The
dependency's type is `readonly HealthCheck[]`.

At `build()`, once the recipes have stopped creating new members, the
container registers the aggregate node. Its dependencies are the DI
tokens of every family member that has a provider, and its value is an
array of their instances. From here it is an ordinary graph node: the
contributions are initialized before the aggregator and destroyed after
it.

Rules of the aggregate:

- every member with a provider lands in the array: explicit
  contributions, members from a recipe, members from `.auto`; a recipe
  is not required for the family;
- `.all` creates no members; a call to `HealthCheck$('orphan')` with no
  provider does not land in the array;
- an empty family gives an empty array, not an error: the feature was
  not selected, and it has no contributions;
- the order of the elements matches the registration order, explicit
  contributions first, then members from the recipe; do not rely on
  the order of `dependsOn`;
- the array is frozen and shared by every consumer of `.all`;
- the aggregate node belongs to no module, and a contribution from
  another module lands in the array with no extra declarations;
- there is no provider with `provide: HealthCheck$.all`: the build
  creates this node itself, and a manual registration under the same
  DI token is a registration error.

The modules in the example are linked through `dependsOn`, as in
chapter [14](../guide/14-features.md): `UsersModule` depends on
`DatabaseModule`, and `AppModule` lists the rest.

## Checking

Run the example and read the output. Every line is signed with the
scope of the logger that wrote it, the aggregate holds both
contributions, and the last line shows the counters from one recipe,
each with its own value:

```
2026-09-08T22:26:13.997Z INFO  UserRepository Loading all users
2026-09-08T22:26:13.997Z INFO  app Health checks critical=1 total=2
2026-09-08T22:26:13.997Z INFO  app Health report={"status":"not_ready","phase":"START","checks":[]}
2026-09-08T22:26:13.997Z INFO  app Counters demo.users=1 demo.queries=1
```

The result here is `not_ready`, and the list of checks is empty:
`@OnStart` runs in the START phase, and readiness comes only in RUN.
This is exactly the node's rule: before RUN and during SHUTDOWN, the
checks do not run at all.

The `demo` prefix came from the config section through the recipe:
`metricsPrefix` is read from `APP_METRICS_PREFIX`, which the example
binds in `main.ts`.

In an app test, the family is replaced as a whole, not by member:
`familyOverride(Counter$, () => …)` from `@nestlingjs/testing` replaces
the recipe before the members are created. `spyLogger()` intercepts the
logger's lines by replacing `RootLogger$`: chapter
[18](../guide/18-testing-features.md).

```bash
yarn start:dev
# the graph with family members in the browser
yarn export-metadata
yarn visualize
```

The same example reads the config from several sources and changes
values without a restart — the recipe [Configuration from a file and
without a restart](./config-sources.md).
