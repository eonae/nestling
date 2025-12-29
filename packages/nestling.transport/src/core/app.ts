import { getHandlerMetadata } from './decorators.js';
import type {
  HandlerConfig,
  MaybeSchema,
  ResponseContext,
  Transport,
} from './interfaces.js';

/**
 * Тип для любого handler-класса (с любыми типами параметров)
 */
type AnyHandlerClass = new (...args: unknown[]) => {
  handle: (...args: any[]) => Promise<ResponseContext<any>>;
};

/**
 * Type guard для проверки, является ли значение декорированным handler-классом
 */
function isHandlerClass(value: unknown): value is AnyHandlerClass {
  return typeof value === 'function' && getHandlerMetadata(value) !== null;
}

/**
 * Класс приложения, управляющий транспортами
 */
export class App {
  private readonly transports = new Map<string, Transport>();

  /**
   * Создает экземпляр App с транспортами
   * @param transports - объект с транспортами {name: transport}
   */
  constructor(transports: Record<string, Transport>) {
    for (const [name, transport] of Object.entries(transports)) {
      this.transports.set(name, transport);
    }
  }

  /**
   * Регистрирует handler-класс с автоматической проверкой типов
   *
   * @param HandlerConstructor - класс, декорированный @Handler
   *
   * @example
   * ```typescript
   * @Handler({
   *   transport: 'http',
   *   method: 'GET',
   *   path: '/users/:id',
   *   payloadSchema: GetUserSchema,
   *   metadataSchema: AuthSchema,
   *   responseSchema: UserResponseSchema,
   * })
   * class GetUser {
   *   async handle(payload, metadata) {
   *     // типы выводятся автоматически!
   *     return { status: 200, value: {...}, meta: {} };
   *   }
   * }
   *
   * app.registerHandler(GetUser);
   * ```
   */
  registerHandler(HandlerConstructor: AnyHandlerClass): void;

  /**
   * Регистрирует handler через конфигурационный объект
   *
   * @param config - конфигурация handler'а
   *
   * @example
   * ```typescript
   * app.registerHandler({
   *   transport: 'cli',
   *   command: 'greet',
   *   handler: async (payload, metadata) => {
   *     return { status: 0, value: {...}, meta: {} };
   *   },
   * });
   * ```
   */
  registerHandler<
    TPayloadSchema extends MaybeSchema = undefined,
    TMetadataSchema extends MaybeSchema = undefined,
    TResponseSchema extends MaybeSchema = undefined,
  >(
    config: HandlerConfig<TPayloadSchema, TMetadataSchema, TResponseSchema>,
  ): void;

  /**
   * Реализация registerHandler с поддержкой обоих API
   */
  registerHandler(input: AnyHandlerClass | HandlerConfig): void {
    if (isHandlerClass(input)) {
      this.registerHandlerClass(input);
    } else {
      this.registerHandlerConfig(input);
    }
  }

  /**
   * Запускает все транспорты
   */
  async listen(): Promise<void> {
    const promises = [...this.transports.values()].map((transport) =>
      transport.listen(),
    );
    await Promise.all(promises);
  }

  /**
   * Останавливает все транспорты
   */
  async close(): Promise<void> {
    const promises = [...this.transports.values()]
      .filter((transport) => transport.close)
      .map((transport) => {
        if (typeof transport.close === 'function') {
          return transport.close();
        }
        return Promise.resolve();
      });

    await Promise.all(promises);
  }

  /**
   * Регистрирует handler через конфигурацию
   */
  private registerHandlerConfig<
    TPayloadSchema extends MaybeSchema = undefined,
    TMetadataSchema extends MaybeSchema = undefined,
    TResponseSchema extends MaybeSchema = undefined,
  >(
    config: HandlerConfig<TPayloadSchema, TMetadataSchema, TResponseSchema>,
  ): void {
    const transport = this.transports.get(config.transport);
    if (!transport) {
      throw new Error(
        `Transport "${config.transport}" not found. Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }

    transport.registerHandler(config);
  }

  /**
   * Регистрирует handler-класс
   */
  private registerHandlerClass(HandlerConstructor: AnyHandlerClass): void {
    const metadata = getHandlerMetadata(HandlerConstructor);

    if (!metadata) {
      throw new Error(
        `Class ${HandlerConstructor.name} is not decorated with @Handler`,
      );
    }

    const transport = this.transports.get(metadata.transport);
    if (!transport) {
      throw new Error(
        `Transport "${metadata.transport}" not found. Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }

    // Создаём инстанс handler-класса
    const instance = new HandlerConstructor();

    // Регистрируем в транспорте
    transport.registerHandler({
      transport: metadata.transport,
      method: metadata.method,
      path: metadata.path,
      payloadSchema: metadata.payloadSchema,
      metadataSchema: metadata.metadataSchema,
      responseSchema: metadata.responseSchema,
      handler: (payload, metadata) => instance.handle(payload, metadata),
    });
  }
}
