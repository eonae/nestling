import type { EndpointDefinition } from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<TInput, TMeta, TOutput>(
    definition: EndpointDefinition<TInput, TMeta, TOutput>,
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
