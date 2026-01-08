import type { Optional, Schema } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  EndpointDefinition,
  MiddlewareFn,
} from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  use(middleware: MiddlewareFn): void;

  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends Optional<Schema> = Optional<Schema>,
  >(
    definition: EndpointDefinition<I, O, M>,
  ): void;

  /**
   * Запускает транспорт (слушает входящие соединения/команды)
   */
  listen(...args: unknown[]): Promise<void>;

  /**
   * Останавливает транспорт
   */
  close?(): Promise<void>;
}
