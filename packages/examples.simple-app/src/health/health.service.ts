import { ILogger } from '../logging';

import { HealthConfig } from './health.config';
import { IHealthCheck } from './registry';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';

// `IHealthCheck.all` — агрегирующий токен семейства: массив всех вкладов,
// зарегистрированных где угодно в собранном контейнере. Массив заморожен и
// типизирован `readonly`, поэтому подмешать вклад в рантайме нельзя.
@Injectable([IHealthCheck.all, HealthConfig, ILogger.auto])
export class HealthService {
  #checks: readonly IHealthCheck[];
  #config: Config<typeof HealthConfig>;
  #logger: ILogger;

  constructor(
    checks: readonly IHealthCheck[],
    config: Config<typeof HealthConfig>,
    logger: ILogger,
  ) {
    this.#checks = checks;
    this.#config = config;
    this.#logger = logger;
  }

  async report(): Promise<string[]> {
    // Печать секции редактирована, хотя `secret()` в ней не написано:
    // ключ пометила секция `app`, а секретность считается объединением.
    // Само значение при этом читается настоящим — редактируется печать.
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
