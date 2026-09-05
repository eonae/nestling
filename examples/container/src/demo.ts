import { AppConfig } from './config/app.config.js';
import { HealthService } from './health/index.js';
import { Logger } from './logging/index.js';
import { RateLimiter } from './runtime/index.js';
import { UserService } from './users/index.js';
import { AppService } from './app.service.js';
import type { ApiClient, Database } from './interfaces.js';
import { ApiClient$, Database$ } from './interfaces.js';

import type { Config } from '@nestling/config';
import { Injectable, OnStart } from '@nestling/container';

/**
 * Провайдер с `@OnStart`: показывает собранный граф.
 *
 * `@OnStart` выполняется, когда граф собран и `@OnInit` всех провайдеров
 * завершён. Под `assemble` это единственное место, где код приложения
 * получает инстансы: сам контейнер наружу не отдаётся.
 */
@Injectable([
  UserService,
  Database$,
  ApiClient$,
  Logger('app'),
  AppService,
  HealthService,
  RateLimiter,
  AppConfig,
])
export class Demo {
  constructor(
    private readonly users: UserService,
    private readonly database: Database,
    private readonly api: ApiClient,
    private readonly logger: Logger,
    private readonly app: AppService,
    private readonly health: HealthService,
    private readonly limiter: RateLimiter,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();

    // Секретное поле печатается как `'***'`; спред `{ ...config }` вернул бы
    // настоящее значение
    this.logger.log('Config (printed):', this.config);
    this.logger.log('Config (as JSON):', JSON.stringify(this.config));

    this.logger.log('Users:', await this.users.getUsers());
    this.logger.log('API Response:', await this.api.get('/api/users'));
    this.logger.log('App Info:', await this.app.getAppInfo());
    this.logger.log('Rate limit:', this.limiter.limit);

    // Вклады из module:database и module:api собраны в массив на build()
    this.logger.log('Health:', await this.health.report());
  }
}
