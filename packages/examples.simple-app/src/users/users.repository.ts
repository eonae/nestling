import { IDatabase } from '../interfaces';

import { Injectable } from '@nestling/container';

@Injectable([IDatabase])
export class UserRepository {
  #database: IDatabase;

  constructor(database: IDatabase) {
    this.#database = database;
  }

  async findAll(): Promise<string[]> {
    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
