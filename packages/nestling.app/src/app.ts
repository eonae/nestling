/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */
import type { BuiltContainer, Module, Provider } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';
import {
  getAllEndpoints,
  getAllMiddleware,
  getEndpointMetadata,
} from '@nestling/pipeline';
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
   * 3. Автоматически обнаруживает и регистрирует endpoints через registry
   * 4. Автоматически обнаруживает и регистрирует middleware через registry
   *
   * Метод идемпотентен - можно вызывать повторно безопасно.
   *
   * @throws {Error} Если endpoint/middleware в registry, но не в контейнере
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

    // 3. Автоматически регистрируем middleware
    this.#registerMiddleware();

    // 4. Автоматически регистрируем endpoints
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
   * 1. Инициализирует контейнер и регистрирует endpoints/middleware
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
   * Автоматически регистрирует все endpoints из registry
   *
   * @private
   */
  #registerEndpoints(): void {
    if (!this.#container) {
      throw new Error('Container must be built before registering endpoints');
    }

    const endpointClasses = getAllEndpoints();

    for (const EndpointClass of endpointClasses) {
      const metadata = getEndpointMetadata(EndpointClass);

      if (!metadata) {
        console.warn(
          `Endpoint class ${EndpointClass.name} is in registry but has no metadata. Skipping.`,
        );
        continue;
      }

      // Получаем инстанс из контейнера
      const instance = this.#container.get(EndpointClass);
      if (!instance) {
        throw new Error(
          `Endpoint '${EndpointClass.name}' is registered in the endpoint registry, ` +
            `but is not available in the DI container. ` +
            `Make sure it is decorated with @Injectable and added to a module's providers or endpoints array.`,
        );
      }

      // Находим соответствующий транспорт
      const transport = this.transports.get(metadata.transport);
      if (!transport) {
        throw new Error(
          `Transport "${metadata.transport}" not found for endpoint ${EndpointClass.name}. ` +
            `Available transports: ${[...this.transports.keys()].join(', ')}`,
        );
      }

      // Регистрируем endpoint в транспорте
      transport.endpoint({
        transport: metadata.transport,
        pattern: metadata.pattern,
        input: metadata.input,
        metadata: metadata.metadata,
        output: metadata.output,
        handle: (payload, meta) => instance.handle(payload, meta),
      });
    }
  }

  /**
   * Автоматически регистрирует все middleware из registry
   *
   * @private
   */
  #registerMiddleware(): void {
    if (!this.#container) {
      throw new Error('Container must be built before registering middleware');
    }

    const middlewareClasses = getAllMiddleware();

    for (const MiddlewareClass of middlewareClasses) {
      // Получаем инстанс из контейнера
      const instance = this.#container.getOrThrow(MiddlewareClass);
      if (!instance) {
        throw new Error(
          `Middleware '${MiddlewareClass.name}' is registered in the middleware registry, ` +
            `but is not available in the DI container. ` +
            `Make sure it is decorated with @Injectable and added to a module's providers or middleware array.`,
        );
      }

      // Регистрируем middleware глобально во всех транспортах
      for (const transport of this.transports.values()) {
        transport.use((ctx, next) => instance.apply(ctx, next));
      }
    }
  }
}
