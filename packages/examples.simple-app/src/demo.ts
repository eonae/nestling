import { AppService } from './app.service';
import { HealthService } from './health';
import { IApiClient, IDatabase } from './interfaces';
import { ILogger } from './logging';
import { UserService } from './users';

import { Injectable, OnStart } from '@nestling/container';

/**
 * Демонстрация собранного графа — провайдер с `@OnStart`.
 *
 * Почему хук, а не «достать инстансы из контейнера в корне»: под
 * `assemble` контейнер не является публичной поверхностью, а `@OnStart` —
 * ровно та фаза, где граф уже собран и проинициализирован целиком. То же
 * место, куда автор кладёт запуск планировщиков и консьюмеров.
 */
@Injectable([
  UserService,
  IDatabase,
  IApiClient,
  ILogger('app'),
  AppService,
  HealthService,
])
export class Demo {
  constructor(
    private readonly users: UserService,
    private readonly database: IDatabase,
    private readonly api: IApiClient,
    private readonly logger: ILogger,
    private readonly app: AppService,
    private readonly health: HealthService,
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();

    this.logger.log('Users:', await this.users.getUsers());
    this.logger.log('API Response:', await this.api.get('/api/users'));
    this.logger.log('App Info:', await this.app.getAppInfo());

    // Multi-injection: вклады из module:database и module:api собраны в
    // массив на build(), без центрального списка и рантайм-резолюции
    this.logger.log('Health:', await this.health.report());
  }
}
