import { Injectable } from '../../framework';
import { IDatabase } from '../di';

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
