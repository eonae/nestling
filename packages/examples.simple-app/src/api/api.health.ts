import type { IHealthCheck } from '../health';
import { IApiClient } from '../interfaces';

import { Injectable } from '@nestling/container';

// Второй вклад — в другом модуле и с другой зависимостью. Чтобы он попал в
// массив агрегатора, достаточно зарегистрировать его в `ApiModule`.
@Injectable([IApiClient])
export class ApiHealthCheck implements IHealthCheck {
  readonly name = 'api';

  #client: IApiClient;

  constructor(client: IApiClient) {
    this.#client = client;
  }

  async check(): Promise<string> {
    await this.#client.get('/health');

    return 'ok';
  }
}
