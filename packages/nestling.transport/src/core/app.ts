import { getHandlerMetadata } from './decorators.js';
import type { HandlerConfig, Transport } from './interfaces.js';
import type { Constructor, IHandler, MaybeSchema } from './types';

/**
 * Type guard для проверки, является ли значение декорированным handler-классом
 */
function isHandlerClass<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
>(value: unknown): value is Constructor<IHandler<P, M, R>> {
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
   * Реализация registerHandler с поддержкой обоих API
   */
  registerHandler<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(input: Constructor<IHandler<P, M, R>> | HandlerConfig<P, M, R>): void {
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
  private registerHandlerClass<
    P extends MaybeSchema = MaybeSchema,
    M extends MaybeSchema = MaybeSchema,
    R extends MaybeSchema = MaybeSchema,
  >(ctor: Constructor<IHandler<P, M, R>>): void {
    const metadata = getHandlerMetadata<P, M, R>(ctor);

    if (!metadata) {
      throw new Error(`Class ${ctor.name} is not decorated with @Handler`);
    }

    const transport = this.transports.get(metadata.transport);
    if (!transport) {
      throw new Error(
        `Transport "${metadata.transport}" not found. Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }

    // Создаём инстанс handler-класса
    const instance = new ctor();

    // Регистрируем в транспорте
    transport.registerHandler<P, M, R>({
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
