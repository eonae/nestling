import type { ApiClient } from '../interfaces.js';
import { ApiClient$ } from '../interfaces.js';

import type { HealthCheck, HealthStatus } from '@nestling/app';
import { Component } from '@nestling/container';

/**
 * Проверка внешнего API: второй вклад в семейство ядра.
 *
 * Некритичная: внешний API отвалился, но своё приложение обслуживает
 * запросы — уводить с него трафик не за что.
 */
@Component([ApiClient$])
export class ApiHealthCheck implements HealthCheck {
  readonly critical = false;

  #client: ApiClient;

  constructor(client: ApiClient) {
    this.#client = client;
  }

  async check(_signal: AbortSignal): Promise<HealthStatus> {
    await this.#client.get('/health');

    return 'ok';
  }
}
