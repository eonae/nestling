import type { HealthCheck } from '../health';
import type { Database } from '../interfaces';
import { Database$ } from '../interfaces';

import { Injectable } from '@nestling/container';

/** Проверка базы: вклад модуля в семейство `HealthCheck` */
@Injectable([Database$])
export class DatabaseHealthCheck implements HealthCheck {
  readonly name = 'database';

  #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async check(): Promise<string> {
    const rows = await this.#database.query('SELECT 1');

    return rows.length > 0 ? 'ok' : 'empty';
  }
}
