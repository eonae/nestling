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

A fully functional, type-safe dependency injection container with zero dependencies.

**Key features:**
- 🎯 Type-safe with excellent TypeScript inference
- 🪶 Lightweight with zero dependencies
- 🎪 Uses standard ECMAScript decorators (not experimental TypeScript ones)
- 🔍 Transparent dependency graph with visualization support
- 🎯 No circular dependencies allowed (by design)
- 📦 Can be used standalone - frontend, CLI, any framework

👉 **[Read the full documentation](./packages/nestling.container/README.md)** | **[Документация на русском](./packages/nestling.container/README.ru.md)**

### 📊 @nestling/viz

Interactive visualization tool for your dependency graph.

**Features:**
- 🎨 Beautiful interactive graph visualization
- 🔍 Explore dependencies visually
- 🌳 Understand your application structure at a glance
- 🎯 Identify potential issues in your dependency tree

Generate a visualization of your container's dependency graph and explore it in your browser.

### 📚 Example Application

Want to see it in action? Check out the **[simple-app example](./packages/examples.simple-app/)** that demonstrates:
- Module organization
- Dependency injection patterns
- Lifecycle hooks
- Factory providers
- Dynamic tokens

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

const userService = container.get(UserService);
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
- ✅ Zero dependencies for better security
- ✅ Explicit over implicit everywhere

**[Read more about the philosophy →](./packages/nestling.container/README.md#how-nestling-di-differs-from-nestjs-and-what-they-share)**

## Roadmap

- [x] DI Container (`@nestling/container`)
- [x] Dependency graph visualization (`@nestling/viz`)
- [ ] HTTP framework (`@nestling/http`)
- [ ] Request context with AsyncLocalStorage (`@nestling/context`)
- [ ] Common utilities and patterns
- [ ] CLI scaffolding tool
- [ ] Testing utilities

## Project Structure

This is a monorepo containing:

```
packages/
├── nestling.container/     # Core DI container
├── nestling.viz/          # Dependency graph visualization
├── examples.simple-app/   # Example application
├── common.graphs/         # Graph utilities
└── common.static-server/  # Static file server
```

## Contributing

This is a personal project, but suggestions and discussions are welcome! Feel free to open issues with ideas or questions.

## License

MIT © 2025

---

**Note:** The journey that led to creating yet another JavaScript framework will be documented separately. But the short version: explicit is better than implicit, and simplicity is a feature.

