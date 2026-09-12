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
