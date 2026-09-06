import { AppConfig } from '../config/app.config.js';
import type { Counter } from '../counters/index.js';
import { Counter$ } from '../counters/index.js';
import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component } from '@nestling/container';

/**
 * База данных в памяти: реализация токена `Database$`.
 *
 * Секция конфига инжектится как обычная зависимость: регистрировать её
 * отдельно не нужно. Привязку класса к токену `Database$` даёт
 * `classProvider` в `database.module.ts`, а не сам декоратор.
 */
@Component([AppConfig, Counter$('queries'), Logger$('db')])
export class InMemoryDatabase implements Database {
  #config: Config<typeof AppConfig>;
  #queries: Counter;
  #logger: Logger;

  constructor(
    config: Config<typeof AppConfig>,
    queries: Counter,
    logger: Logger,
  ) {
    this.#config = config;
    this.#queries = queries;
    this.#logger = logger;
  }

  async connect(): Promise<void> {
    // В лог уходит хост, а не URL с паролем: секрет защищает только печать
    // самого фреймворка
    this.#logger.info('Connecting to database', {
      host: new URL(this.#config.databaseUrl).host,
    });
  }

  async query(sql: string): Promise<any[]> {
    this.#logger.info('Executing query', {
      sql,
      total: this.#queries.increment(),
    });

    return [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
  }
}
