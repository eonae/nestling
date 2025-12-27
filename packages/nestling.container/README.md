# @nestling/container

A lightweight, type-safe dependency injection container for TypeScript with zero dependencies. Built on standard JavaScript decorators, it serves as the foundation for the Nestling.js framework.

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
- Lifecycle methods `OnInit` and `OnDestroy` for providers. Unlike Nest.js, they execute in strict **topological order** when you call the corresponding methods (`init` and `destroy`) on the container.
- A module system simpler than Nest.js, and optional. You can register providers without modules.
- Auto-registration of providers and modules through decorators and relationships. If all your providers are organized into modules and those modules import into a root module, you only need to register the root module in the container. Dependencies are pulled in automatically.

## Standalone Usage (Including in Browsers)

Yes, another important difference. While the Nest container is built into the application and inseparable, `@nestling/container` is an independent, small package with zero dependencies that can be used anywhere: frontend, CLI applications, even with your favorite framework like Fastify or, God forbid, Express.

> A frontend tech lead I know requested lazy provider initialization - so dependency subtrees in the container would be created when `container.get(...)` is called. Still thinking about this, as it somewhat complicates the implementation, which I desperately resist.

## On Simplicity

Few lines of code, good inline documentation via JSDoc and comments, zero dependencies, and clear algorithms - all valuable in themselves.

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

### Lifecycle Hooks: Where They Belong

Lifecycle hooks (`@OnInit`, `@OnDestroy`) are for services, not modules:

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

**See also**: the "Dynamic Providers" section below contains an additional warning about metadata accumulation when creating multiple instances of the same class.

### Dynamic Providers: Tokens with Parameters

Sometimes you need multiple instances of the same interface with different configurations. For example, different loggers for different parts of your app:

```typescript
// Define the logger interface
interface ILogger {
  log(message: string): void;
}

// Create a factory function for tokens (example from @examples.simple-app)
const ILogger = (context: string) => makeToken<ILogger>(`ILogger:${context}`);

// In a module, use a factory function to dynamically create providers:
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: () => [ // <- Function, not array!
    factoryProvider(
      ILogger('app'),
      () => new ConsoleLogger('app'),
      []
    ),
    factoryProvider(
      ILogger('db'),
      () => new ConsoleLogger('db'),
      []
    )
  ],
  exports: [ILogger('app'), ILogger('db')]
});
```

The function form allows you to compute providers dynamically. This is especially useful when:
- You need parameterized tokens
- Providers depend on runtime configuration
- You're loading providers asynchronously

The function is called during the build phase, giving you a chance to set up dynamic dependencies before instantiation begins.

**Important**: if you create multiple instances of the same class (e.g., `new ConsoleLogger('app')` and `new ConsoleLogger('db')`), each instance will execute its own lifecycle hooks. This is normal if each instance needs its own initialization (e.g., establish its own connection).

However, if you need **shared initialization once for all instances** (e.g., a single connection pool), the right pattern is to extract the shared logic into a separate singleton dependency:

```typescript
// Define interface and token for connection pool
interface IConnectionPool {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

// Shared resource - singleton with lifecycle hooks
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

// Loggers use the shared resource
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: () => [
    ConnectionPool,
    factoryProvider(
      ILogger('app'),
      (pool) => new ConsoleLogger('app', pool),
      [IConnectionPool]
    ),
    factoryProvider(
      ILogger('db'),
      (pool) => new ConsoleLogger('db', pool),
      [IConnectionPool]
    )
  ],
  exports: [ILogger('app'), ILogger('db')]
});
```

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
- `Injectable(deps: InjectionToken[])` - Decorate a class as injectable
- `Injectable(token: TokenString, deps: InjectionToken[])` - Injectable with explicit token
- `makeModule(config: Module): Module` - Create a module

### Provider Factories

- `classProvider<T>(token, class)` - Create a class provider (class must be decorated with `@Injectable`)
- `valueProvider<T>(token, value)` - Create a value provider
- `factoryProvider<T>(token, factory, deps)` - Create a factory provider

### Container API

- `new ContainerBuilder()` - Create a builder
- `.register(...providers | ...modules)` - Register dependencies
- `.build()` - Build the container (async)
- `container.get<T>(token)` - Get an instance
- `container.init()` - Run initialization hooks
- `container.destroy()` - Run destruction hooks
- `container.toJSON()` - Export dependency graph

## License

MIT