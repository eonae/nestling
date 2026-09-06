import type { HealthCheck } from '../health/index.js';
import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';

import { Component } from '@nestling/container';

/** Проверка базы: вклад модуля в семейство `HealthCheck` */
@Component([Database$])
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
