import type { Optional, Schema } from '@common/misc';
import type {
  HandlerConfig,
  HandlerFn,
  Input,
  Output,
} from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  /**
   * Регистрирует handler через конфигурацию
   */
  endpoint<
    I extends Input = Schema,
    O extends Output = Schema,
    M extends Optional<Schema> = Optional<Schema>,
  >(
    config: HandlerConfig<I, O, M>,
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

/**
 * Конфигурация маршрута
 */
export interface RouteConfig<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> {
  pattern: string;

  /** Конфигурация входных данных */
  input?: I;

  /** Схема метаданных */
  metadata?: M;

  /** Конфигурация выходных данных */
  output?: O;

  handle: HandlerFn<I, O, M>;
}
