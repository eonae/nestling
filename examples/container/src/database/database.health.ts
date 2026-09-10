import { HealthConfig } from '../health/index.js';
import type { Database } from '../interfaces.js';
import { Database$ } from '../interfaces.js';

import type { Config, HealthCheck, HealthStatus } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

/**
 * Проверка базы: вклад в семейство ядра `HealthCheck$`.
 *
 * Имя проверки задаёт член семейства (`HealthCheck$('database')` в
 * `database.module.ts`), поэтому в самом классе его нет. Секция `health` —
 * второй читатель ключа `DATABASE_URL`: у каждой секции своя схема, а
 * секретность ключа общая.
 */
@Component([Database$, HealthConfig])
export class DatabaseHealthCheck implements HealthCheck {
  /** База — внешнее соединение: без неё приложение не обслуживает запросы */
  readonly critical = true;

  #database: Database;
  #config: Config<typeof HealthConfig>;

  constructor(database: Database, config: Config<typeof HealthConfig>) {
    this.#database = database;
    this.#config = config;
  }

  async check(_signal: AbortSignal): Promise<HealthStatus> {
    // Хост читается из секции: значение настоящее, а печать секции скрыла
    // бы его — ключ помечен `secret()` в секции `app`
    void new URL(this.#config.databaseUrl).host;

    const rows = await this.#database.query('SELECT 1');

    return rows.length > 0 ? 'ok' : 'down';
  }
}
