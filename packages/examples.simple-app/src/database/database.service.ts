import { IConfig, IDatabase } from '../interfaces';
import { ILogger } from '../logging';

import { Injectable } from '@nestling/container';

@Injectable(IDatabase, [IConfig, ILogger('db')])
export class Database implements IDatabase {
  #config: IConfig;
  #logger: ILogger;

  constructor(config: IConfig, logger: ILogger) {
    this.#config = config;
    this.#logger = logger;
  }

  async connect(): Promise<void> {
    this.#logger.log(`Connecting to database: ${this.#config.databaseUrl}`);
  }

  async query(sql: string): Promise<any[]> {
    this.#logger.log(`Executing query: ${sql}`);
    return [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
  }
}
