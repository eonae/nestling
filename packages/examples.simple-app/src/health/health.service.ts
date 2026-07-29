import { ILogger } from '../logging';

import { IHealthCheck } from './registry';

import { Injectable } from '@nestling/container';

// `IHealthCheck.all` — агрегирующий токен семейства: массив всех вкладов,
// зарегистрированных где угодно в собранном контейнере. Массив заморожен и
// типизирован `readonly`, поэтому подмешать вклад в рантайме нельзя.
@Injectable([IHealthCheck.all, ILogger.auto])
export class HealthService {
  #checks: readonly IHealthCheck[];
  #logger: ILogger;

  constructor(checks: readonly IHealthCheck[], logger: ILogger) {
    this.#checks = checks;
    this.#logger = logger;
  }

  async report(): Promise<string[]> {
    this.#logger.log(`Running ${this.#checks.length} health checks`);

    return await Promise.all(
      this.#checks.map(
        async (check) => `${check.name}: ${await check.check()}`,
      ),
    );
  }
}
