import { Logger } from '../logging/index.js';

import { HealthConfig } from './health.config.js';
import { HealthCheck } from './registry.js';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';

/**
 * Агрегатор проверок: `HealthCheck.all` даёт массив всех вкладов, где бы
 * они ни были зарегистрированы. Массив заморожен и типизирован `readonly`.
 */
@Injectable([HealthCheck.all, HealthConfig, Logger.auto])
export class HealthService {
  #checks: readonly HealthCheck[];
  #config: Config<typeof HealthConfig>;
  #logger: Logger;

  constructor(
    checks: readonly HealthCheck[],
    config: Config<typeof HealthConfig>,
    logger: Logger,
  ) {
    this.#checks = checks;
    this.#config = config;
    this.#logger = logger;
  }

  async report(): Promise<string[]> {
    // Печать секции скрывает секрет, хотя `secret()` объявлен в секции `app`
    this.#logger.log('Health config (printed):', this.#config);
    this.#logger.log(
      `Running ${this.#checks.length} health checks against ${new URL(this.#config.databaseUrl).host}`,
    );

    return await Promise.all(
      this.#checks.map(
        async (check) => `${check.name}: ${await check.check()}`,
      ),
    );
  }
}
