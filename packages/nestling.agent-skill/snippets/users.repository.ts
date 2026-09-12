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
