import { IDatabase } from '../interfaces';
import { ILogger } from '../logging';

import { Injectable } from '@nestling/container';

// `ILogger.auto` резолвится в `ILogger('UserRepository')` прямо в момент
// декорирования: consumer-aware логгер без transient-скоупа и рантайм-магии.
@Injectable([IDatabase, ILogger.auto])
export class UserRepository {
  #database: IDatabase;
  #logger: ILogger;

  constructor(database: IDatabase, logger: ILogger) {
    this.#database = database;
    this.#logger = logger;
  }

  async findAll(): Promise<string[]> {
    this.#logger.log('Loading all users');

    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
