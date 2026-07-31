# @nestling/container

A lightweight, type-safe dependency injection container for TypeScript with no third-party dependencies. Built on standard JavaScript decorators, it serves as the foundation for the Nestling.js framework.

> 🚧 Active development, API evolving. Target design in
> [`docs/design/container.md`](../../docs/design/container.md).

## Disclaimer

`Nestling` is my personal take on Nest.js - a framework I both love and find frustrating.

Essentially, it takes what my teams and I actually use from Nest.js while leaving behind what we don't need. What's "unnecessary" is subjective, of course. The journey that led me to create yet another JS framework will be documented separately - it might be interesting.

But not here.

What matters here is that while Nest.js positions itself as an opinionated solution, `Nestling` is even more opinionated.

## ECMAScript Decorators

Before diving into detailed comparisons and container features, it's worth mentioning a key difference: `Nestling` doesn't use experimental TypeScript decorators. Instead, it uses standard JavaScript decorators from the ES specification.

I miss parameter decorators too, but the standard actually has several advantages, discussed below.

## How Nestling DI Differs from Nest.js (and What They Share)

**What's NOT here:**
- `ForwardRef` - because circular dependencies **should never exist!**
- `REQUEST` and `TRANSIENT` scopes for providers. Strictly speaking, Scope.REQUEST can't really be a DI container's responsibility. It's a complex feature that tightly couples the container with the application using it. Instead, `@nestling/app` provides a convenient wrapper around AsyncLocalStorage. As for Scope.TRANSIENT, there's an On-Demand injection mechanism (described below).
- Modules as classes. And consequently, no lifecycle hooks on modules, configure methods, or other Nest.js module features. In Nest, the order of hook execution is unclear, especially with module hooks. Few people can say off the top of their head whether `OnModuleInit` runs first on the module or on its services.

**What IS here:**
- Three familiar provider types: value, class, and factory
- Simplified class provider declaration using the `@Injectable` decorator
- Injection tokens, just like in Nest.js, can be class references or strings, but thanks to [branded types](https://dev.to/themuneebh/typescript-branded-types-in-depth-overview-and-use-cases-60e) and helper functions, working with strings is more convenient
- Lifecycle methods `OnInit`, `OnStart` and `OnDestroy` for providers. Unlike Nest.js, they execute in strict **topological order** when you call the corresponding methods (`init`, `start` and `destroy`) on the container.
- A module system simpler than Nest.js, and optional. You can register providers without modules.
- Auto-registration of providers and modules through decorators and relationships. If all your providers are organized into modules and those modules import into a root module, you only need to register the root module in the container. Dependencies are pulled in automatically.

## Standalone Usage (Including in Browsers)

Yes, another important difference. While the Nest container is built into the application and inseparable, `@nestling/container` is an independent, small package with no third-party dependencies that can be used anywhere: frontend, CLI applications, even with your favorite framework like Fastify or, God forbid, Express.

> A frontend tech lead I know requested lazy provider initialization - so dependency subtrees in the container would be created when `container.get(...)` is called. Still thinking about this, as it somewhat complicates the implementation, which I desperately resist.

## On Simplicity

Few lines of code, good inline documentation via JSDoc and comments, no third-party dependencies, and clear algorithms - all valuable in themselves.

But they're also foundations for security, which is becoming an increasingly pressing concern.

## Installation

```bash
npm install @nestling/container
```

## Core Concepts

### DI → DIP → IoC → IoC Container

If you've used Nest.js or libraries like InversifyJS, or if you're well-versed in theory, you don't need an explanation of what an IoC (DI) container is and what problem it solves.

If not, I recommend reading something [like this](https://martinfowler.com/articles/injection.html).

### Providers: The Foundation

In the DI world, a **provider** is like a blueprint telling the container how to create an instance of something. In `Nestling`, just like in Nest.js, providers are either plain definition objects (`ProviderDefinition`) or classes with the `@Injectable` decorator.

```typescript
import { classProvider, valueProvider, factoryProvider } from '@nestling/container';

// Class Provider - instantiate a class
const logger = classProvider(ILogger, ConsoleLogger);

// Value Provider - use an existing value
const config = valueProvider('CONFIG', { apiUrl: 'https://api.example.com' });

// Factory Provider - use a function to create the value
const apiClient = factoryProvider(
  IApiClient,
  (config) => new ApiClient(config.apiUrl),
  ['CONFIG'] // dependencies
);
```

Just like in NestJS, but more explicit. No magic, no confusion.

### Tokens: How Dependencies Are Identified

A **token** is what you use to request a dependency. It can be one of two things:

1. **A class constructor** - the simplest case:
```typescript
class UserService {}

// Token is the class itself
container.get(UserService);
```

2. **A branded string** - for interfaces and abstract dependencies:
```typescript
import { makeToken } from '@nestling/container';

interface ILogger {
  log(message: string): void;
}

// Create a token for the interface
const ILogger = makeToken<ILogger>('ILogger');

// Use it to register and retrieve
container.get(ILogger);
```

**Why is this needed?** Interfaces and types in TypeScript are ephemeral - they disappear during transpilation to JavaScript. The `makeToken` function allows you to **materialize** them: create a runtime representation of the type that can be used as a key in the container. Essentially, it's a branded string with type information attached for TypeScript.

This is exactly how NestJS does it with injection tokens, but here it's more explicit and type-safe.

### The @Injectable Shortcut

When you control the class code, you can use a shortcut instead of writing `classProvider`:

```typescript
import { Injectable } from '@nestling/container';

// Instead of: classProvider(UserService, UserService)
// Just decorate the class:
@Injectable([])
class UserService {
  // your code
}

// With dependencies:
@Injectable([DatabaseService])
class UserRepository {
  constructor(private db: DatabaseService) {}
}

// With interface token:
@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) { console.log(message); }
}
```

**Important**: This only works for classes you can modify. For third-party classes or when you need more control, use explicit providers.

### From Providers to Instances: The Dependency Graph

When you build the container, something interesting happens:

1. **Providers are resolved** into actual instances
2. **Dependencies are wired** - each instance gets its dependencies injected
3. **A DAG (Directed Acyclic Graph) is built** representing the dependency tree
4. **Circular dependencies are detected** and rejected

This is the same three-phase approach as NestJS:
- Registration phase (you define providers)
- Validation phase (circular dependencies checked)
- Instantiation phase (everything comes to life)

```typescript
import { ContainerBuilder } from '@nestling/container';

const container = await new ContainerBuilder()
  .register(UserService)
  .register(DatabaseService)
  .register(LoggerService)
  .build(); // <- validation and instantiation happen here

await container.init(); // <- lifecycle hooks run here
```

**Missing dependencies are reported all at once.** Before instantiation the
builder walks the `deps` of every provider and collects the tokens that have
no provider, together with who asked for them:

```
Unsatisfied dependencies (2):
  - 'IClock' required by 'ReportService'
  - 'UsersRepository' required by 'ReportService', 'ExportService'
Register a provider for each of them (in 'providers:' of a module, or via register()).
```

### Test seam: `overrides` and pruning

Two builder options exist for the test composition root and are documented as
such — `assemble` does not forward them, and production code has no reason to:

```typescript
const container = await new ContainerBuilder({
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  familyOverrides: [{ family: ILogger, recipe: (scope) => valueProvider(ILogger(scope), noop) }],
}).register(UsersModule).build();

container.pruned; // ['UsersStore'] — nodes dropped as orphaned subtrees
```

- **`overrides`** replaces a provider by a value provider **before**
  instantiation, keeping the node's module attribution intact (so
  `strictExports`, the visualization and diagnostics keep naming the owner).
  A fake with `@OnInit`/`@OnDestroy` is an ordinary node. Overriding a token
  that has no provider, or overriding one token twice, fails the build.
- **`familyOverrides`** replaces the recipe of a whole family, strictly
  before member materialization, so the production recipe is never called.
- **Pruning** drops the nodes reachable only through the dependencies of a
  replaced one: they are not instantiated, they are not in the graph, and
  their lifecycle hooks do not run. Roots are the tokens with zero in-degree
  in the union of the dependency relations before and after the substitution,
  plus the tokens unreachable from those (cycle participants still have to
  reach the cycle detector). Aggregates (`Family.all`) are materialized after
  pruning, and an edge to `Family.all` expands to every current member.
- The invariant that makes this safe: **without `overrides` the two relations
  coincide, so pruning is the identity** — a production build keeps every
  registered node, including the ones nobody references. `container.pruned`
  is empty there.

### Manual Registration vs Modules

You can register dependencies manually, one by one:

```typescript
const container = await new ContainerBuilder()
  .register(DatabaseService)
  .register(UserRepository)
  .register(UserService)
  .register(valueProvider('CONFIG', config))
  .build();
```

**But wait!** Each provider you register must have ALL its dependencies also registered. The container doesn't auto-register transitive dependencies - you must be explicit. This is by design: explicit is better than implicit.

For better organization, use **modules**:

```typescript
import { makeModule } from '@nestling/container';

const databaseModule = makeModule({
  name: 'DatabaseModule',
  providers: [DatabaseService, ConnectionPool],
  exports: [DatabaseService] // only this is visible outside
});

const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule], // gets DatabaseService from here
  providers: [UserRepository, UserService],
  exports: [UserService]
});

const container = await new ContainerBuilder()
  .register(userModule)
  .build();
```

### Modules: Plain Objects, Not Classes

Here's where we diverge from NestJS. In Nest, modules are classes with decorators:

```typescript
// NestJS way - modules are classes
@Module({
  imports: [DatabaseModule],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
```

**Why?** There's no good reason. Modules don't have lifecycle hooks (services do), they don't have business logic, they're just configuration. Making them classes adds ceremony without benefit.

**@nestling/container** keeps it simple:

```typescript
// Our way - modules are plain objects
const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule],
  providers: [UserService],
  exports: [UserService]
});
```

Cleaner. Simpler. Just configuration.

#### Module Identity Is the Value

A module is identified by its **value**, not by its name. The same value met
again - through `imports`, through the root and a feature, through two
features sharing one infrastructure module - is registered once: the
providers factory does not run twice and no duplicate nodes appear.

The name is the **attribution key** of the module's providers, exports and
endpoints, so two *different* values under one name are a build error, not a
silent win for the first one:

```
Two different modules are named 'module:logging'. A module name is the
attribution key of its providers and exports, so it must be unique. Either
share one module value between its consumers (create it once and import that
value), or give the two configurations different names. If neither is the
case, check for a duplicated package in your dependencies - two copies give
two values of the same module.
```

Comparison is referential. There is no structural comparison of options and
no memoization of parameterized modules by arguments: walking arbitrary
values at build time is exactly the runtime magic this container avoids, and
it would turn a silent loss into a silent merge.

#### Parameterized Modules

A parameterized module is just a function returning a module - no
`DynamicModule`, no `forRoot`, no configuration stage:

```typescript
export const logging = (options: { service: string }) =>
  makeModule({
    name: 'module:logging',
    providers: [/* ... */],
    exports: [ILogger],
  });

// create the value once, share it by importing it
export const appLogging = logging({ service: 'orders-api' });
```

Calling the factory a second time - even with equal options - produces
another value under the same name, and the build fails as above.

### Lifecycle Hooks: Where They Belong

Lifecycle hooks (`@OnInit`, `@OnStart`, `@OnDestroy`) are for services, not modules:

```typescript
import { Injectable, OnInit, OnDestroy } from '@nestling/container';

@Injectable([])
class DatabaseService {
  @OnInit()
  async connect() {
    console.log('Connecting to database...');
    // initialization logic
  }

  @OnDestroy()
  async disconnect() {
    console.log('Disconnecting...');
    // cleanup logic
  }
}
```

The container calls these hooks in the right order:
- `init()`: calls `@OnInit` hooks in topological order (dependencies first)
- `start()`: calls `@OnStart` hooks in topological order — after `@OnInit`
  of the **whole** graph, so a start hook sees a fully wired application
  (schedulers, consumers, subscriptions belong here). Idempotent: a repeated
  call runs nothing
- `destroy()`: calls `@OnDestroy` hooks in reverse topological order

This is similar to NestJS's `OnModuleInit` and `OnModuleDestroy`, but without the module class ceremony.

#### Important: Hook Registration and Testing

Lifecycle hook metadata is registered when **each class instance is created** (via the `context.addInitializer` mechanism in decorators). This means if you create multiple instances of the same class, metadata can accumulate.

In normal usage, this isn't a problem since the container creates singletons - one instance per class. However, in **tests** this can cause unexpected behavior if classes are reused between tests:

```typescript
// ❌ Problem: class defined outside beforeEach
@Injectable(IService, [])
class MyService {
  @OnInit()
  async init() { /* ... */ }
}

describe('Tests', () => {
  it('test 1', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // First instance creation - metadata registered
  });

  it('test 2', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // Second instance creation - metadata added again!
  });
});

// ✅ Solution: redefine classes in beforeEach
describe('Tests', () => {
  let MyService: any;

  beforeEach(() => {
    @Injectable(IService, [])
    class MyServiceImpl {
      @OnInit()
      async init() { /* ... */ }
    }
    MyService = MyServiceImpl;
  });

  it('test 1', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // Each test uses a fresh constructor
  });
});
```

Redefining classes in `beforeEach` ensures each test works with clean metadata.

**See also**: the "Dynamic Providers" section below explains how lifecycle hooks behave when one recipe produces many instances.

### Dynamic Providers: Token Families

Sometimes you need multiple instances of the same interface with different configurations - different loggers for different parts of your app, a client per upstream, a queue per name. That is a **token family**: one recipe, many members addressed by a parameter.

```typescript
interface ILoggerService {
  log(message: string): void;
}

// A family of tokens. Calling it produces an ordinary memoized token:
// ILogger('users') === 'Logger:users'
const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
```

A member is a plain `TokenString`, so it works everywhere a token works - `@Injectable` deps, factory provider deps, `container.get()`:

```typescript
@Injectable([ILogger('users')])
class UserService {
  constructor(private logger: ILoggerService) {}
}
```

You register **one recipe for the whole family**, not a provider per member. The recipe returns an ordinary provider definition:

```typescript
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: [
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (config: IConfig) => new ConsoleLogger(scope, config),
        [IConfig] as const,
      ),
    ),
  ],
  exports: [ILogger], // the whole family, not member by member
});
```

On `build()` the container collects every family member mentioned in the deps of registered providers, calls the recipe **once per distinct parameter**, and registers the result as an ordinary graph node. From that point on a member is indistinguishable from a hand-registered provider: eager instantiation, deduplication (two consumers of `ILogger('users')` share one instance), cycle detection, lifecycle hooks, module attribution, visualization.

There is no runtime resolution. A member nobody depends on is never created, and `container.get()` returns `null` for it. If a recipe's own provider depends on another family member, the collection repeats until it finds nothing new.

**Rule: members are created only by calling the family.** `makeToken<ILoggerService>('Logger:users')` produces a string that merely looks like a member - the container will report it as a missing provider (with a hint pointing at the family).

The build fails with a targeted error when a member is requested but no `familyProvider` is registered for its family, when the recipe returns a provider for a different token, or when a second recipe is registered for the same family.

#### Consumer-aware members: `Family.auto`

`ILogger.auto` is a sentinel that `@Injectable` replaces with `ILogger('<DecoratedClassName>')` **at decoration time** - the consumer is known statically, so nothing is resolved at runtime:

```typescript
@Injectable([IDatabase, ILogger.auto])
class UserRepository {
  // gets the member 'Logger:UserRepository'
  constructor(private db: IDatabase, private logger: ILoggerService) {}
}
```

This covers the Nest `transient + INQUIRER` case without a transient scope. Two classes using `.auto` get two distinct members from the same recipe; an `.auto` member and an explicit `ILogger('UserRepository')` are the same node.

Limitations in v1: `.auto` is only valid in the deps of a class decorated with `@Injectable`. In a factory provider's deps (there is no consumer class there) it is a registration error; on a class with an empty `constructor.name` it fails at decoration. The escape hatch is the explicit call. Because member ids come from `constructor.name`, minifiers that rename classes would rename members too - the target environment is server-side Node without minification.

#### Multi-injection: `Family.all`

The mirror case of a recipe: many independently registered contributions, one aggregator that does not know the composition. A **contribution is an ordinary provider** with a member token, registered wherever it belongs:

```typescript
const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>('HealthCheck');

// database.module.ts
providers: [classProvider(IHealthCheck('database'), DatabaseHealthCheck)],
exports: [IHealthCheck],

// api.module.ts - a different module, no edit to the first one
providers: [classProvider(IHealthCheck('api'), ApiHealthCheck)],
exports: [IHealthCheck],
```

The aggregator depends on the sentinel `IHealthCheck.all`, typed as `TokenString<readonly HealthCheck[]>`:

```typescript
@Injectable([IHealthCheck.all])
class HealthService {
  constructor(private checks: readonly HealthCheck[]) {}
}
```

On `build()` - after the member materialization fixpoint - the container registers a **synthetic aggregate node** whose deps are the tokens of every registered member of the family and whose instance is the array of their instances. From there it is an ordinary node: cycle detection, topological `init()`/`destroy()` (contributions initialize before the aggregate's consumers and are destroyed after them), `toJSON()`, visualization, `strictExports`.

The rules worth knowing:

- **composition** - every member that has a provider when the aggregate is created: explicit contributions, members materialized by the recipe, and members obtained from `.auto`. A `familyProvider` is not required: a family with nothing but explicit contributions aggregates just fine.
- **`.all` forces no materialization** - a member created by calling `IHealthCheck('orphan')` but never depended on and never provided stays out of the array (and out of the graph);
- **an unreferenced `.all` creates no node** - `container.get(IHealthCheck.all)` returns `null`;
- **an empty family is an empty array**, not an error - "the feature was not selected, so its contributions are absent" is a normal state;
- **order is registration order** - modules and providers in the order they were registered, then members added by the materialization fixpoint. It is deterministic and nothing more is promised: if the order carries meaning (a middleware chain), do not lean on `imports` order;
- **the array is `readonly` and frozen** - it is a build snapshot shared by every consumer, so a mutation by one would be visible to the rest;
- **the aggregate belongs to no module**, so under `strictExports` its edge to a contribution owned by module M requires M to export it - listing the family (`exports: [IHealthCheck]`) exports all its members at once;
- **the token is reserved**: registering a provider with `provide: IHealthCheck.all` is an error, and so is the member parameter `'{all}'`.

#### Lifecycle of members

Each member is its own instance and runs its own lifecycle hooks. This is what you want when every instance owns a resource (its own connection, for example).

If instead you need **shared initialization once for all members** (a single connection pool), extract the shared part into an ordinary singleton and depend on it from the recipe:

```typescript
const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

@Injectable(IConnectionPool, [])
class ConnectionPool implements IConnectionPool {
  @OnInit()
  async initialize() {
    console.log('Initialize connection pool once');
  }

  @OnDestroy()
  async cleanup() {
    console.log('Close pool');
  }
}

const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: [
    ConnectionPool,
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (pool: IConnectionPool) => new ConsoleLogger(scope, pool),
        [IConnectionPool] as const,
      ),
    ),
  ],
  exports: [ILogger],
});
```

### Module Visibility: strictExports

Module `exports` are metadata by default - nothing is enforced, and visibility is really decided by ES modules: a token you do not export from your package cannot be requested from outside it.

If you want the declarations checked, turn on the opt-in build-time lint:

```typescript
const container = await new ContainerBuilder({ strictExports: true })
  .register(AppModule)
  .build();
```

With `strictExports: true`, `build()` walks the finished graph and, for every edge `consumer → dependency` where the dependency belongs to module M and the consumer does not, requires the dependency token to be listed in M's `exports`. Rules:

- edges inside a single module are always allowed;
- dependencies that belong to no module are consumed freely;
- a missing or empty `exports` means **nothing is exported** - if you opt into the strict mode, declare exports honestly;
- a token family in `exports` exports all its materialized members;
- all violations are reported in a single error as a list of `consumer → dependency (module)`.

This is a lint over the built graph, not runtime encapsulation: there are no visibility checks in `get()` or during injection. The flag is off by default, so existing containers keep building unchanged.

## Complete Example

Let's build a simple app with logging, database, and user management:

```typescript
import {
  Injectable,
  makeToken,
  makeModule,
  ContainerBuilder,
  OnInit,
  OnDestroy,
  valueProvider,
  factoryProvider
} from '@nestling/container';

// 1. Define interfaces and tokens
interface ILogger {
  log(message: string): void;
}

interface IDatabase {
  query(sql: string): Promise<any>;
}

const ILogger = makeToken<ILogger>('ILogger');
const IDatabase = makeToken<IDatabase>('IDatabase');

// 2. Implement services with lifecycle hooks
@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(`[LOG] ${message}`);
  }
}

@Injectable(IDatabase, [])
class PostgresDatabase implements IDatabase {
  @OnInit()
  async connect() {
    console.log('Connecting to PostgreSQL...');
  }

  @OnDestroy()
  async disconnect() {
    console.log('Disconnecting from PostgreSQL...');
  }

  async query(sql: string) {
    return `Result of: ${sql}`;
  }
}

@Injectable([IDatabase, ILogger])
class UserService {
  constructor(
    private db: IDatabase,
    private logger: ILogger
  ) {}

  async getUsers() {
    this.logger.log('Fetching users');
    return this.db.query('SELECT * FROM users');
  }
}

// 3. Organize into modules
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: [ConsoleLogger],
  exports: [ILogger]
});

const databaseModule = makeModule({
  name: 'DatabaseModule',
  imports: [loggingModule],
  providers: [PostgresDatabase],
  exports: [IDatabase]
});

const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule, loggingModule],
  providers: [UserService],
  exports: [UserService]
});

// 4. Build and use
async function main() {
  const container = await new ContainerBuilder()
    .register(userModule)
    .build();

  await container.init();

  const userService = container.get(UserService);
  const users = await userService.getUsers();
  console.log(users);

  await container.destroy();
}

main().catch(console.error);
```

## Comparison with NestJS

| Feature | NestJS | @nestling/container |
|---------|--------|---------------------|
| Modules | Classes with decorators | Plain objects |
| Providers | Implicit via decorators | Explicit definitions + shortcuts |
| Tokens | Injection tokens or classes | Same: branded strings or classes |
| Lifecycle | `OnModuleInit`, `OnModuleDestroy` | `@OnInit`, `@OnDestroy` on services |
| Dependency Graph | Hidden | Accessible via `toJSON()` |
| Circular Dependencies | Detected | Detected |
| Type Safety | Good (with emitDecoratorMetadata) | Excellent (full inference) |
| Learning Curve | Steep | Gentle |

**The Philosophy**: NestJS optimizes for feature completeness. **@nestling/container** optimizes for clarity and simplicity. Same power, less magic.

## Advanced: Dependency Graph Visualization

One unique feature: full access to the dependency graph:

```typescript
const container = await new ContainerBuilder()
  .register(appModule)
  .build();

// Export as JSON
const graph = await container.toJSON();
console.log(JSON.stringify(graph, null, 2));

// Traverse manually
await container.traverse(
  (node) => {
    console.log(`${node.id} depends on:`, 
      node.dependencies.map(d => d.id)
    );
  },
  { direction: 'topological' }
);
```

Use **@nestling/viz** for interactive visualization of your dependency tree.

## API Reference

### Core Functions

- `makeToken<T>(id: string): TokenString<T>` - Create an injection token
- `makeTokenFamily<T, [param: string]>(name): TokenFamily<T>` - Create a family of tokens; `Family(param)` returns the memoized member token `"<name>:<param>"`, `Family.auto` is the consumer-aware sentinel, `Family.all` (`TokenString<readonly T[]>`) is the multi-injection aggregate sentinel
- `Injectable(deps: InjectionToken[])` - Decorate a class as injectable
- `Injectable(token: TokenString, deps: InjectionToken[])` - Injectable with explicit token
- `makeModule(config: Module): Module` - Create a module

### Provider Factories

- `classProvider<T>(token, class)` - Create a class provider (class must be decorated with `@Injectable`)
- `valueProvider<T>(token, value)` - Create a value provider
- `factoryProvider<T>(token, factory, deps)` - Create a factory provider
- `familyProvider<T>(family, recipe)` - Register one recipe for a whole token family; the recipe `(param) => ProviderDefinition<T>` is called once per referenced member at build time

### Container API

- `new ContainerBuilder(options?: { strictExports?, overrides?, familyOverrides? })` - Create a builder; `overrides`/`familyOverrides` are the test composition root seam (see above)
- `.register(...providers | ...familyProviders | ...modules)` - Register dependencies
- `.build()` - Build the container (async)
- `container.get<T>(token)` - Get an instance, or `null` if not registered
- `container.getOrThrow<T>(token)` - Get an instance, throws if not registered
- `container.pruned` - Ids of the nodes dropped as subtrees orphaned by `overrides`; empty on any build without them
- `container.init()` - Run initialization hooks
- `container.destroy()` - Run destruction hooks
- `container.toJSON()` - Export dependency graph

## License

MIT