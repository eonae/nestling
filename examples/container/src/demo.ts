import { AppConfig } from './config/app.config.js';
import type { Counter } from './counters/index.js';
import { Counter$ } from './counters/index.js';
import { RateLimiter } from './runtime/index.js';
import { UserService } from './users/index.js';
import { AppService } from './app.service.js';
import type { ApiClient, Database } from './interfaces.js';
import { ApiClient$, Database$ } from './interfaces.js';

import type { Config, Health, HealthCheck, Logger } from '@nestling/app';
import { Health$, HealthCheck$, Logger$ } from '@nestling/app';
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
  Health$,
  HealthCheck$.all,
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
    private readonly health: Health,
    private readonly checks: readonly HealthCheck[],
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

    // Вклады из module:database и module:api собраны в массив на build():
    // `.all` работает на ядерном семействе так же, как на своём
    this.logger.info('Health checks', {
      critical: this.checks.filter((check) => check.critical).length,
      total: this.checks.length,
    });

    // Узел ядра отдаёт отчёт значением. `@OnStart` выполняется на фазе
    // START, а готовность наступает в RUN — поэтому итог здесь `not_ready`,
    // и проверки не запускаются вовсе
    this.logger.info('Health', { report: await this.health.readiness() });

    // Члены одного семейства из одного рецепта: у каждого свой счёт
    this.logger.info('Counters', {
      [this.userCalls.name]: this.userCalls.value,
      [this.queries.name]: this.queries.value,
    });
  }
}
