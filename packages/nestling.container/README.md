# @nestling/container

A lightweight, type-safe dependency injection container for TypeScript. Inspired by NestJS but designed to be simpler and more explicit.

## Why Another DI Container?

If you've worked with NestJS, you know its DI system is powerful but comes with complexity - decorators on everything, modules as classes, metadata reflection, and a learning curve that can be steep.

**@nestling/container** takes the best ideas from NestJS (and Angular before it) but simplifies the implementation:

- ✅ Modules are plain objects, not classes - no unnecessary abstraction
- ✅ Full TypeScript type safety without experimental decorators flags (uses stage 3 decorators)
- ✅ Explicit provider definitions alongside convenient shortcuts
- ✅ Built-in dependency graph for debugging and visualization
- ✅ Lifecycle hooks where you need them - on services, not modules

## Installation

```bash
npm install @nestling/container
```

## Core Concepts

### Providers: The Foundation

In the DI world, a **provider** tells the container how to create an instance of something. Providers are plain objects with a `provide` field that specifies the **token** (the key) and one of three creation strategies:

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

### Dynamic Providers: Tokens with Parameters

Sometimes you need multiple instances of the same interface with different configurations. For example, different loggers for different parts of your app:

```typescript
// In @examples.simple-app
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

- `classProvider<T>(token, class)` - Create a class provider
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