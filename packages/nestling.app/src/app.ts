/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */
import type { EndpointDiscovery } from './discovery';
import { assertEndpointsDeclared, discoverEndpoints } from './discovery';

import type { BuiltContainer, Module, Provider } from '@nestling/container';
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
   * импортировано процессом.
   *
   * @private
   */
  #registerEndpoints(): void {
    if (!this.#container) {
      throw new Error('Container must be built before registering endpoints');
    }

    const discovery = discoverEndpoints(this.modules);

    // Ручка с метаданными, не попавшая ни в один endpoints:, обслуживаться
    // не будет — молчать про это нельзя
    assertEndpointsDeclared(this.modules, this.providers);

    this.#assertRequiredTransports(discovery);

    for (const {
      endpoint: EndpointClass,
      metadata,
      moduleName,
    } of discovery.endpoints) {
      // Получаем инстанс из контейнера
      const instance = this.#container.get(EndpointClass);
      if (!instance) {
        throw new Error(
          `Endpoint '${EndpointClass.name}' is declared in 'endpoints:' of module '${moduleName}', ` +
            `but is not available in the DI container. ` +
            `Make sure it is decorated with @Injectable and added to a module's providers or endpoints array.`,
        );
      }

      // Транспорт заведомо есть: множество требуемых сверено выше
      const transport = this.transports.get(metadata.transport) as ITransport;

      // Резолвим классы-юниты пайплайна контейнером (bind): транспорт
      // принимает только исполнимый пайплайн (TNeeds = never)
      const pipeline = metadata.pipeline?.bind((ctor) => {
        const unit = this.#container?.get(ctor);
        if (!unit) {
          throw new Error(
            `Pipeline unit '${ctor.name}' used by endpoint '${EndpointClass.name}' ` +
              `is not available in the DI container. ` +
              `Make sure it is decorated with @Injectable and added to a module's providers.`,
          );
        }
        return unit;
      });

      // Регистрируем endpoint в транспорте
      // В новой архитектуре metadata содержит pipeline
      transport.endpoint({
        ...metadata,
        pipeline,
        handle: instance.handle.bind(instance),
      });
    }
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

      const [{ endpoint, metadata, moduleName }] = endpoints;

      throw new Error(
        `Transport '${name}' is required by endpoint '${endpoint.name}' ('${metadata.pattern}') ` +
          `declared in module '${moduleName}', but is not configured. ` +
          `Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }
  }
}
