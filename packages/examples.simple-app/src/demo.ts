import { AppConfig } from './config/app.config';
import { AppService } from './app.service';
import { HealthService } from './health';
import { IApiClient, IDatabase } from './interfaces';
import { ILogger } from './logging';
import { UserService } from './users';

import type { Config } from '@nestling/config';
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
  AppConfig,
])
export class Demo {
  constructor(
    private readonly users: UserService,
    private readonly database: IDatabase,
    private readonly api: IApiClient,
    private readonly logger: ILogger,
    private readonly app: AppService,
    private readonly health: HealthService,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();

    // Секретное поле напечатано как `'***'`: `console.log` инспектирует
    // объект, а у проекции с секретами есть `inspect.custom`. Спред
    // (`{ ...this.config }`) хук обошёл бы — это названная граница
    // гарантии, а не дефект: фреймворк отвечает за то, что печатает сам.
    this.logger.log('Config (printed):', this.config);
    this.logger.log('Config (as JSON):', JSON.stringify(this.config));

    this.logger.log('Users:', await this.users.getUsers());
    this.logger.log('API Response:', await this.api.get('/api/users'));
    this.logger.log('App Info:', await this.app.getAppInfo());

    // Multi-injection: вклады из module:database и module:api собраны в
    // массив на build(), без центрального списка и рантайм-резолюции
    this.logger.log('Health:', await this.health.report());
  }
}
