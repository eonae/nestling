# Nestling

> A lightweight, opinionated replacement for Nest.js with ECMAScript decorators and zero magic

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**[🇷🇺 Русская версия](./README.ru.md)**

## ⚠️ Active Development

**Nestling** is currently in active development. The project is evolving, and APIs may change. Use at your own risk in production environments.

## What is Nestling?

Nestling is a personal take on Nest.js - a framework that's both loved and frustrating. It takes what teams actually use from Nest.js while leaving behind the unnecessary complexity.

Like Nest.js positions itself as opinionated, **Nestling is even more opinionated**.

## Current Status

Right now, Nestling includes:

### ✅ @nestling/container

A fully functional, type-safe dependency injection container with no third-party dependencies.

**Key features:**
- 🎯 Type-safe with excellent TypeScript inference
- 🪶 Lightweight, no third-party dependencies
- 🎪 Uses standard ECMAScript decorators (not experimental TypeScript ones)
- 🔍 Transparent dependency graph with visualization support
- 🎯 No circular dependencies allowed (by design)
- 📦 Can be used standalone - frontend, CLI, any framework

👉 **[Read the full documentation](./packages/nestling.container/README.md)** | **[Документация на русском](./packages/nestling.container/README.ru.md)**

### 🚧 HTTP/CLI framework (active development, APIs changing)

- **@nestling/pipeline** — typed, transport-agnostic request pipeline: schema-first endpoints (zod), typed middleware chains, `Ok`/`Fail` results, streaming io
- **@nestling/app** — application assembly: container + transports, endpoint auto-discovery, lifecycle, graceful shutdown
- **@nestling/transport.http** — HTTP transport on bare `node:http` (routing, JSON/multipart/NDJSON parsing)
- **@nestling/transport.cli** — CLI transport: commands as endpoints, single-shot and REPL modes
- **@nestling/models** — type-safe model definitions on top of zod
- **@nestling/testing** — test composition root: `assembleTest`, overrides with pruning, `checkTopologies`
- **@nestling/eslint-plugin** — editor hints for endpoint declarations (`endpoint-has-layer`); the guarantee stays the assembly policy check

The target design is evolving in [`docs/decisions/`](./docs/decisions/ideas.md); usage guides in [`docs/guides/`](./docs/README.md).

### 📊 @nestling/viz

Interactive visualization tool for your dependency graph.

**Features:**
- 🎨 Beautiful interactive graph visualization
- 🔍 Explore dependencies visually
- 🌳 Understand your application structure at a glance
- 🎯 Identify potential issues in your dependency tree

Generate a visualization of your container's dependency graph and explore it in your browser.

### 📚 Examples

- [simple-app](./packages/examples.simple-app/) — standalone DI: modules, factory providers, parameterized tokens, lifecycle hooks
- [simple-http-server](./packages/examples.simple-http-server/) — functional HTTP endpoints ([guide](./docs/guides/http-functional.md))
- [app-with-http](./packages/examples.app-with-http/) — full App with DI and class endpoints ([guide](./docs/guides/http-app-di.md))
- [simple-cli](./packages/examples.simple-cli/) — CLI transport ([guide](./docs/guides/cli.md))

## Installation

```bash
npm install @nestling/container
```

## Quick Start

```typescript
import { Injectable, makeModule, ContainerBuilder } from '@nestling/container';

// Define a service
@Injectable([])
class UserService {
  getUsers() {
    return ['Alice', 'Bob'];
  }
}

// Create a module
const appModule = makeModule({
  name: 'AppModule',
  providers: [UserService],
  exports: [UserService]
});

// Build and use the container
const container = await new ContainerBuilder()
  .register(appModule)
  .build();

await container.init();

const userService = container.getOrThrow(UserService);
console.log(userService.getUsers()); // ['Alice', 'Bob']

await container.destroy();
```

## Why Nestling?

### What's Different from Nest.js?

**Removed:**
- ❌ `ForwardRef` - circular dependencies should never exist
- ❌ `REQUEST` and `TRANSIENT` scopes - better handled at the app layer
- ❌ Modules as classes - they're just configuration, no need for ceremony

**Improved:**
- ✅ Modules are plain objects (simpler, cleaner)
- ✅ Lifecycle hooks in strict topological order
- ✅ Full access to dependency graph
- ✅ Standard JavaScript decorators
- ✅ No third-party dependencies for better security
- ✅ Explicit over implicit everywhere

**[Read more about the philosophy →](./packages/nestling.container/README.md#how-nestling-di-differs-from-nestjs-and-what-they-share)**

## Roadmap

- [x] DI Container (`@nestling/container`)
- [x] Dependency graph visualization (`@nestling/viz`)
- [x] Typed request pipeline (`@nestling/pipeline`) — evolving, see [docs/decisions](./docs/decisions/ideas.md)
- [x] HTTP transport (`@nestling/transport.http`) — works, not production-hardened yet
- [x] CLI transport (`@nestling/transport.cli`)
- [x] Application assembly (`@nestling/app`)
- [ ] Pipeline v2: phases, layers, `compose` ([design decisions](./docs/decisions/ideas.md))
- [ ] Token families & module factories
- [ ] Request context with AsyncLocalStorage (`@nestling/context`)
- [ ] Subscriptions registry (`@nestling/subscriptions`)
- [ ] CLI scaffolding tool
- [ ] Testing utilities

## Documentation

All documentation lives in [`docs/`](./docs/README.md), organized by status:

- [`docs/design/`](./docs/README.md) — target design (source of truth for the API)
- [`docs/decisions/`](./docs/decisions/ideas.md) — architecture decision log with reasoning
- `docs/history/` — frozen discussions, migrations, and work logs

Package-level READMEs document the current state of the code.

## Project Structure

This is a monorepo containing:

```
docs/                          # Design docs, decisions, guides, history
packages/
├── nestling.container/        # Core DI container
├── nestling.pipeline/         # Typed request pipeline & endpoints
├── nestling.streams/          # Topic, item-chain combinators, AbortSignal helpers
├── nestling.app/              # Application assembly & lifecycle
├── nestling.transport/        # Transport abstraction
├── nestling.transport.http/   # HTTP transport
├── nestling.transport.cli/    # CLI transport
├── nestling.models/           # Model definitions on top of zod
├── nestling.testing/          # Test composition root
├── nestling.eslint-plugin/    # ESLint hints for endpoint declarations
├── nestling.viz/              # Dependency graph visualization
├── examples.simple-app/       # Example: standalone DI
├── examples.simple-http-server/  # Example: functional HTTP
├── examples.app-with-http/    # Example: App + DI + HTTP
├── examples.simple-cli/       # Example: CLI transport
├── common.graphs/             # Internal: DAG utilities
├── common.misc/               # Internal: shared helpers
└── common.static-server/      # Internal: static file server (for viz)
```

## Contributing

This is a personal project, but suggestions and discussions are welcome! Feel free to open issues with ideas or questions.

## License

MIT © 2025

---

**Note:** The journey that led to creating yet another JavaScript framework will be documented separately. But the short version: explicit is better than implicit, and simplicity is a feature.

