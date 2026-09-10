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
