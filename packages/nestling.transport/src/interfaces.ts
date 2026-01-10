import type {
  AnyInput,
  AnyMeta,
  AnyOutput,
  EndpointDefinition,
} from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends AnyMeta = AnyMeta,
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
