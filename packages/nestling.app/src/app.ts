import type { Constructor, Optional, Schema } from '@common/misc';
import type {
  HandlerConfig,
  IEndpoint,
  InferInput,
  Input,
  Output,
} from '@nestling/pipeline';
import { getEndpointMetadata } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
/**
 * Type guard для проверки, является ли значение декорированным handler-классом
 */
function isHandlerClass<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(value: unknown): value is Constructor<IEndpoint<I, O, M>> {
  return typeof value === 'function' && getEndpointMetadata(value) !== null;
}

/**
 * Класс приложения, управляющий транспортами
 */
export class App {
  private readonly transports = new Map<string, ITransport>();

  /**
   * Создает экземпляр App с транспортами
   * @param transports - объект с транспортами {name: transport}
   */
  constructor(transports: Record<string, ITransport>) {
    for (const [name, transport] of Object.entries(transports)) {
      this.transports.set(name, transport);
    }
  }

  /**
   * Реализация endpoint с поддержкой обоих API
   */
  endpoint<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(input: Constructor<IEndpoint<I, O, M>> | HandlerConfig<I, O, M>): void {
    if (isHandlerClass<I, O, M>(input)) {
      this.registerClass(input);
    } else {
      this.registerPlain(input);
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
  private registerPlain<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(config: HandlerConfig<I, O, M>): void {
    const transport = this.transports.get(config.transport);
    if (!transport) {
      throw new Error(
        `Transport "${config.transport}" not found. Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }

    transport.endpoint(config);
  }

  /**
   * Регистрирует handler-класс
   */
  private registerClass<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(
    ctor: Constructor<{
      handle(payload: InferInput<I>, metadata: any): Promise<any>;
    }>,
  ): void {
    const metadata = getEndpointMetadata<I, O, M>(ctor);

    if (!metadata) {
      throw new Error(`Class ${ctor.name} is not decorated with @Endpoint`);
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
    transport.endpoint({
      transport: metadata.transport,
      pattern: metadata.pattern,
      input: metadata.input,
      metadata: metadata.metadata,
      output: metadata.output,
      handle: (payload, metadataParam) =>
        instance.handle(payload, metadataParam),
    });
  }
}
