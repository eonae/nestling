import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
} from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  /**
   * Регистрирует handler через декларацию-значение.
   *
   * Принимается только **исполнимая** декларация (`TNeeds = never`):
   * неразрешённые зависимости хендлера и классы-юниты пайплайна гасит
   * `endpoint.resolve(resolver)` — под `App` это происходит автоматически
   * на старте, standalone — руками.
   */
  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(
    definition: EndpointDefinition<I, O, P, never>,
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
