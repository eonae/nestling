import { AppConfig } from '../config/app.config';
import { IDatabase } from '../interfaces';
import { ILogger } from '../logging';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';

// Секция инжектится как обычная зависимость: узел графа материализуется
// самим фактом упоминания токена в deps — регистрировать её негде и незачем.
@Injectable(IDatabase, [AppConfig, ILogger('db')])
export class Database implements IDatabase {
  #config: Config<typeof AppConfig>;
  #logger: ILogger;

  constructor(config: Config<typeof AppConfig>, logger: ILogger) {
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
