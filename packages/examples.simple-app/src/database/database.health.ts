import type { IHealthCheck } from '../health';
import { IDatabase } from '../interfaces';

import { Injectable } from '@nestling/container';

// Вклад в семейство — обычный класс-провайдер. Ни `HealthService`, ни какой-либо
// центральный список о нём не знают: связь возникает на `build()` через членский
// токен `IHealthCheck('database')`.
@Injectable([IDatabase])
export class DatabaseHealthCheck implements IHealthCheck {
  readonly name = 'database';

  #database: IDatabase;

  constructor(database: IDatabase) {
    this.#database = database;
  }

  async check(): Promise<string> {
    const rows = await this.#database.query('SELECT 1');

    return rows.length > 0 ? 'ok' : 'empty';
  }
}
