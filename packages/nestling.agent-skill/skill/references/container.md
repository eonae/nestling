# Container

The container holds a graph of providers and its lifecycle. `assemble()`
builds the graph and stops on a missing dependency, a cycle or a class in
the wrong role; instances are created afterwards, all of them, in
topological order. Names live in the README of
[`@nestlingjs/container`](https://www.npmjs.com/package/@nestlingjs/container).

## DI tokens

A class is its own token. An interface has no run-time identity, so it gets
one: `makeToken<UsersRepository>('UsersRepository')`, named after the
interface with the suffix `$`. Depend on the token, not on the class that
implements it — that is what lets a test replace it with one line.

There are no `exports` and no `imports` on a module: a token that its file
does not export cannot be injected, and that is the whole visibility rule.

## Roles of a class

The decorator says what the class is, and its argument is the dependency
list. The list must match the constructor by type, order and length.

| Decorator | For | Created |
|---|---|---|
| `@Component([…])` | a service | on INIT, once |
| `@Resource([…])` | a connection, a pool, anything to close | `static acquire` on INIT, `release` on SHUTDOWN |
| `@Handler([…])` | an endpoint handler or a pipeline unit | on INIT, once |

<!-- snippet: users.repository.ts -->
```typescript
import type { User } from './api-operations.js';
import { Database } from './database.js';

import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';
import { Component, makeToken } from '@nestlingjs/container';

/** Everything endpoints need from storage */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
}

/**
 * A DI token gives the interface a name at run time. Endpoints depend on
 * the token, so a test replaces storage with one line in `overrides`.
 */
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');

/**
 * `@Component` marks a service. The dependency list is a value: the same
 * tokens, in the same order and of the same length as the constructor
 * parameters. There is no `emitDecoratorMetadata` and no `reflect-metadata`.
 */
@Component([Database, Logger$.auto, Ctx(RequestId)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    // Request data is read from the async context, not passed down as an
    // argument: providers stay singletons
    private readonly requestId: CtxReader<string>,
  ) {}

  async all(): Promise<User[]> {
    this.logger.debug('all', { requestId: this.requestId.peek() ?? 'n/a' });

    return this.db.users;
  }

  async byId(id: string): Promise<User | null> {
    return this.db.users.find((user) => user.id === id) ?? null;
  }

  async byEmail(email: string): Promise<User | null> {
    return this.db.users.find((user) => user.email === email) ?? null;
  }
}
```

`Logger$.auto` is a token family: the member is chosen by the consumer, so
the logger arrives already named after the class that asked for it.
`Ctx(RequestId)` reads a context variable of the current request: providers
stay singletons and request data is not threaded through arguments. Read it
with `peek()` when the same method may also run outside a request.

<!-- snippet: database.ts -->
```typescript
import type { User } from './api-operations.js';
import { AppConfig } from './app.config.js';

import type { Config, Logger } from '@nestlingjs/app';
import { Logger$ } from '@nestlingjs/app';
import { Resource } from '@nestlingjs/container';

/**
 * A connection is a resource: `acquire` opens it on INIT in topological
 * order, `release` closes it on SHUTDOWN in reverse. The constructor gets
 * an already open handle, so no field is ever `undefined`.
 */
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    _signal: AbortSignal,
  ): Promise<Database> {
    logger.info('database connected', { host: config.databaseHost });

    return new Database([{ id: '1', name: 'Alice', email: 'a@example.com' }]);
  }

  private constructor(readonly users: User[]) {}

  release(): void {
    this.users.length = 0;
  }
}
```

## Modules and providers

A module is an object that groups providers under a name. It is usually
declared in the file of the feature that owns it.

<!-- snippet: users.module.ts -->
```typescript
import { AppConfig } from './app.config.js';
import { Database } from './database.js';
import { DbUsersRepository, UsersRepository$ } from './users.repository.js';

import type { Config } from '@nestlingjs/app';
import {
  classProvider,
  factoryProvider,
  makeModule,
  makeToken,
} from '@nestlingjs/container';

export interface Clock {
  now(): Date;
}

export const Clock$ = makeToken<Clock>('Clock');

/**
 * A module is a plain object that groups providers under a name. It has no
 * `imports` and no `exports`: visibility is held by ES modules, and a token
 * that a file does not export cannot be injected.
 */
export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    // A class is its own token
    Database,
    // An interface token is bound to the class that implements it
    classProvider(UsersRepository$, DbUsersRepository),
    // A factory runs during assembly and must not do any I/O
    factoryProvider(
      Clock$,
      (_config: Config<typeof AppConfig>) => ({ now: () => new Date() }),
      [AppConfig] as const,
    ),
  ],
});
```

- `classProvider(token, Class)` binds an interface token to a class.
- `factoryProvider(token, fn, deps)` builds a value; `deps` is positional
  and `fn` must be synchronous and free of I/O.
- `valueProvider(token, value)` registers a ready value.
- A bare class registers itself.

## Phases

`run()` walks the application through phases and stops it in reverse on
`SIGTERM` and `SIGINT`.

| Phase | What happens |
|---|---|
| 0 BOOTSTRAP | config sources are read, before the container exists |
| 1 ASSEMBLE | the graph is built, endpoints are discovered, policies are checked |
| 2 INIT | instances are created and resources acquired, in graph order |
| 3 WIRE | handlers and units are resolved, the dispatch table is built |
| 4 START | `@OnStart()` runs, transports are served, sockets open last |
| 6 SHUTDOWN | the reverse: transports close, `release` runs backwards |

Anything that fails on ASSEMBLE fails before a single request is served.
That is the point: keep work that can fail out of the request path and put
it into the declaration.
