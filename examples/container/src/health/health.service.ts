import { HealthConfig } from './health.config.js';
import { HealthCheck } from './registry.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component } from '@nestling/container';

/**
 * Агрегатор проверок: `HealthCheck.all` даёт массив всех вкладов, где бы
 * они ни были зарегистрированы. Массив заморожен и типизирован `readonly`.
 */
@Component([HealthCheck.all, HealthConfig, Logger$.auto])
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
    this.#logger.info('Health config', { config: this.#config });
    this.#logger.info('Running health checks', {
      checks: this.#checks.length,
      host: new URL(this.#config.databaseUrl).host,
    });

    return await Promise.all(
      this.#checks.map(
        async (check) => `${check.name}: ${await check.check()}`,
      ),
    );
  }
}
