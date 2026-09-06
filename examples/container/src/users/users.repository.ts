import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';

import type { Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component } from '@nestling/container';

/**
 * `Logger$.auto` подставляет член `Logger$('UserRepository')`: имя берётся
 * из класса-потребителя в момент декорирования.
 */
@Component([Database$, Logger$.auto])
export class UserRepository {
  #database: Database;
  #logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.#database = database;
    this.#logger = logger;
  }

  async findAll(): Promise<string[]> {
    this.#logger.info('Loading all users');

    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
