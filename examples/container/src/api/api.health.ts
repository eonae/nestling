import type { HealthCheck } from '../health/index.js';
import type { ApiClient } from '../interfaces.js';
import { ApiClient$ } from '../interfaces.js';

import { Component } from '@nestling/container';

/** Проверка внешнего API: второй вклад в семейство `HealthCheck` */
@Component([ApiClient$])
export class ApiHealthCheck implements HealthCheck {
  readonly name = 'api';

  #client: ApiClient;

  constructor(client: ApiClient) {
    this.#client = client;
  }

  async check(): Promise<string> {
    await this.#client.get('/health');

    return 'ok';
  }
}
