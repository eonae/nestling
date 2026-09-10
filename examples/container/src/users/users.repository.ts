import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';

import type { Logger } from '@nestlingjs/app';
import { Logger$ } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

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
