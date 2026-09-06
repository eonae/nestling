import { AppConfig } from './config/app.config.js';
import type { Counter } from './counters/index.js';
import { Counter$ } from './counters/index.js';
import { HealthService } from './health/index.js';
import { RateLimiter } from './runtime/index.js';
import { UserService } from './users/index.js';
import { AppService } from './app.service.js';
import type { ApiClient, Database } from './interfaces.js';
import { ApiClient$, Database$ } from './interfaces.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component, OnStart } from '@nestling/container';

/**
 * Компонент с `@OnStart`: показывает собранный граф.
 *
 * `@OnStart` выполняется на фазе START, после того как фаза INIT создала
 * экземпляры всех компонентов и захватила все ресурсы. Под `assemble` это
 * единственное место, где код приложения получает инстансы: сам контейнер
 * наружу не отдаётся.
 */
@Component([
  UserService,
  Database$,
  ApiClient$,
  Logger$('app'),
  AppService,
  HealthService,
  RateLimiter,
  AppConfig,
  Counter$('users'),
  Counter$('queries'),
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
    private readonly userCalls: Counter,
    private readonly queries: Counter,
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();

    // Секретное поле печатается как `'***'`: логгер сериализует объект
    // через JSON, а спред `{ ...config }` вернул бы настоящее значение
    this.logger.info('Config', { config: this.config });

    this.logger.info('Users', { users: await this.users.getUsers() });
    this.logger.info('API Response', {
      response: await this.api.get('/api/users'),
    });
    this.logger.info('App Info', { info: await this.app.getAppInfo() });
    this.logger.info('Rate limit', { rps: this.limiter.limit });

    // Вклады из module:database и module:api собраны в массив на build()
    this.logger.info('Health', { report: await this.health.report() });

    // Члены одного семейства из одного рецепта: у каждого свой счёт
    this.logger.info('Counters', {
      [this.userCalls.name]: this.userCalls.value,
      [this.queries.name]: this.queries.value,
    });
  }
}
