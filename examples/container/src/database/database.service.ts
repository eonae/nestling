import { AppConfig } from '../config/app.config.js';
import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';
import { Logger } from '../logging/index.js';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';

/**
 * База данных в памяти: реализация токена `Database$`.
 *
 * Секция конфига инжектится как обычная зависимость: регистрировать её
 * отдельно не нужно.
 */
@Injectable(Database$, [AppConfig, Logger('db')])
export class InMemoryDatabase implements Database {
  #config: Config<typeof AppConfig>;
  #logger: Logger;

  constructor(config: Config<typeof AppConfig>, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  async connect(): Promise<void> {
    // В лог уходит хост, а не URL с паролем: секрет защищает только печать
    // самого фреймворка
    this.#logger.log(
      `Connecting to database: ${new URL(this.#config.databaseUrl).host}`,
    );
  }

  async query(sql: string): Promise<any[]> {
    this.#logger.log(`Executing query: ${sql}`);
    return [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
  }
}
