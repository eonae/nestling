/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */
import type { EndpointDiscovery } from './discovery';
import { discoverEndpoints } from './discovery';

import type {
  BuiltContainer,
  InjectionToken,
  Module,
  Provider,
} from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';
import type { ITransport } from '@nestling/transport';

/**
 * Конфигурация приложения
 */
export interface AppConfig {
  /** Транспорты приложения */
  transports: Record<string, ITransport>;

  /** Модули приложения */
  modules?: Module[];

  /** Провайдеры приложения (опционально, если не используются модули) */
  providers?: Provider[];
}

/**
 * Класс приложения, управляющий транспортами, endpoints и DI-контейнером
 *
 * @example
 * ```typescript
 * const app = new App({
 *   transports: {
 *     http: new HttpTransport({ port: 3000 }),
 *   },
 *   modules: [LoggingModule, UsersModule],
 * });
 *
 * await app.run();    // Запускает приложение с graceful shutdown
 * // await app.close() вызывается автоматически при SIGTERM/SIGINT
 * ```
 */
export class App {
  private readonly transports = new Map<string, ITransport>();
  private readonly modules: Module[];
  private readonly providers: Provider[];

  #container?: BuiltContainer;
  #initialized = false;

  /**
   * Создает экземпляр App с транспортами и DI-конфигурацией
   *
   * @param config - Конфигурация приложения
   */
  constructor(config: AppConfig) {
    // Регистрируем транспорты
    for (const [name, transport] of Object.entries(config.transports)) {
      this.transports.set(name, transport);
    }

    this.modules = config.modules ?? [];
    this.providers = config.providers ?? [];
  }

  /**
   * Инициализирует приложение:
   * 1. Строит DI-контейнер из модулей и провайдеров
   * 2. Запускает lifecycle hooks (@OnInit)
   * 3. Обнаруживает endpoints обходом дерева модулей и регистрирует их
   *    в транспортах
   *
   * Middleware теперь добавляются через pipeline при определении endpoint'а,
   * а не глобально на транспорт.
   *
   * Метод идемпотентен - можно вызывать повторно безопасно.
   *
   * @throws {Error} Если объявленный endpoint не резолвится контейнером
   * @private
   */
  async #init(): Promise<void> {
    if (this.#initialized) {
      return; // Идемпотентность
    }

    // 1. Строим контейнер
    const builder = new ContainerBuilder();

    // Регистрируем модули
    if (this.modules.length > 0) {
      builder.register(...this.modules);
    }

    // Регистрируем провайдеры
    if (this.providers.length > 0) {
      builder.register(...this.providers);
    }

    // Строим контейнер
    this.#container = await builder.build();

    // 2. Запускаем lifecycle hooks
    await this.#container.init();

    // 3. Автоматически регистрируем endpoints
    this.#registerEndpoints();

    this.#initialized = true;
  }

  /**
   * Запускает все транспорты
   *
   * @throws {Error} Если init() не был вызван
   * @private
   */
  async #listen(): Promise<void> {
    if (!this.#initialized) {
      throw new Error(
        'App must be initialized before listening. Call app.init() first.',
      );
    }

    const promises = [...this.transports.values()].map((transport) =>
      transport.listen(),
    );
    await Promise.all(promises);
  }

  /**
   * Запускает приложение полностью:
   * 1. Инициализирует контейнер и регистрирует endpoints
   * 2. Запускает все транспорты
   * 3. Настраивает graceful shutdown (SIGTERM, SIGINT)
   *
   * Это основной метод для запуска приложения.
   *
   * @example
   * ```typescript
   * const app = new App({
   *   transports: { http: new HttpTransport({ port: 3000 }) },
   *   modules: [UsersModule],
   * });
   *
   * await app.run();
   * console.log('App is running!');
   * ```
   */
  async run(): Promise<void> {
    // 1. Инициализируем
    await this.#init();

    // 2. Запускаем транспорты
    await this.#listen();

    // 3. Настраиваем graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`${signal} received, shutting down...`);
      await this.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Останавливает все транспорты и уничтожает контейнер
   *
   * Вызывает lifecycle hooks (@OnDestroy) для всех сервисов.
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', async () => {
   *   await app.close();
   *   process.exit(0);
   * });
   * ```
   */
  async close(): Promise<void> {
    // Останавливаем транспорты
    const promises = [...this.transports.values()]
      .filter((transport) => transport.close)
      .map((transport) => transport.close?.() ?? Promise.resolve());

    await Promise.all(promises);

    // Уничтожаем контейнер (вызов @OnDestroy hooks)
    if (this.#container) {
      await this.#container.destroy();
    }

    this.#initialized = false;
  }

  /**
   * Регистрирует endpoints, обнаруженные обходом дерева модулей
   *
   * Источник истины — что зарегистрировано в приложении, а не что
   * импортировано процессом. Декларация — значение: инстанцировать нечего,
   * гасятся только её зависимости (токены `deps`, класс-хендлер и
   * классы-юниты пайплайна) — контейнером, до приёма запросов.
   *
   * @private
   */
  #registerEndpoints(): void {
    if (!this.#container) {
      throw new Error('Container must be built before registering endpoints');
    }

    const discovery = discoverEndpoints(this.modules);

    this.#assertRequiredTransports(discovery);

    for (const { endpoint, moduleName } of discovery.endpoints) {
      // Транспорт заведомо есть: множество требуемых сверено выше
      const transport = this.transports.get(endpoint.transport) as ITransport;

      // Гасим зависимости декларации контейнером: транспорт принимает
      // только исполнимое значение (TNeeds = never)
      transport.endpoint(
        endpoint.resolve((token) =>
          this.#requireDependency(token, endpoint.pattern, moduleName),
        ),
      );
    }
  }

  /**
   * Достаёт зависимость декларации из контейнера, называя в ошибке ручку,
   * модуль-объявитель и способ починки.
   *
   * Одинаково обслуживает все три источника: токен из `deps`,
   * класс-хендлер и класс-юнит пайплайна — для автора это одна и та же
   * незарегистрированная зависимость.
   *
   * @private
   */
  #requireDependency(
    token: InjectionToken,
    pattern: string,
    moduleName: string,
  ): unknown {
    const instance = this.#container?.get(token);

    if (!instance) {
      const name = typeof token === 'string' ? token : token.name;

      throw new Error(
        `Dependency '${name}' required by endpoint '${pattern}' ` +
          `declared in module '${moduleName}' is not available in the DI ` +
          `container. Register it in 'providers:' of a module ` +
          `(classes — with @Injectable).`,
      );
    }

    return instance;
  }

  /**
   * Сверяет транспорты, затребованные деревом модулей, с переданными в
   * конструктор. Обратное направление легально: у сконфигурированного
   * транспорта есть маршруты и помимо дискавери.
   *
   * @private
   */
  #assertRequiredTransports(discovery: EndpointDiscovery): void {
    for (const [name, endpoints] of discovery.transports) {
      if (this.transports.has(name)) {
        continue;
      }

      const [{ endpoint, moduleName }] = endpoints;

      throw new Error(
        `Transport '${name}' is required by endpoint '${endpoint.pattern}' ` +
          `declared in module '${moduleName}', but is not configured. ` +
          `Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }
  }
}
