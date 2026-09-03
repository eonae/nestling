import type { HealthCheck } from '../health';
import type { ApiClient } from '../interfaces';
import { ApiClient$ } from '../interfaces';

import { Injectable } from '@nestling/container';

/** Проверка внешнего API: второй вклад в семейство `HealthCheck` */
@Injectable([ApiClient$])
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
