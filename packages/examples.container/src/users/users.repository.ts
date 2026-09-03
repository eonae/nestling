import type { Database } from '../interfaces';
import { Database$ } from '../interfaces';
import { Logger } from '../logging';

import { Injectable } from '@nestling/container';

/**
 * `Logger.auto` подставляет член `Logger('UserRepository')`: имя берётся
 * из класса-потребителя в момент декорирования.
 */
@Injectable([Database$, Logger.auto])
export class UserRepository {
  #database: Database;
  #logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.#database = database;
    this.#logger = logger;
  }

  async findAll(): Promise<string[]> {
    this.#logger.log('Loading all users');

    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
