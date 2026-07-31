import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  TransportCapabilities,
} from '@nestling/pipeline';

/**
 * Способности транспорта по формам io.
 *
 * Тип объявлен ядром (`@nestling/pipeline`), потому что множество форм —
 * kernel-понятие, и проверка биндинга (`assertFormsSupported`) обязана
 * быть одной реализацией для всех путей регистрации. Здесь он
 * реэкспортируется, чтобы автору транспорта хватило одного импорта.
 */
export type { TransportCapabilities } from '@nestling/pipeline';

/**
 * Базовый интерфейс транспорта
 */
export interface ITransport {
  /**
   * Формы io, которые транспорт умеет принимать и отдавать.
   *
   * Обязательное поле: способности — данные транспорта, а не конвенция и
   * не рантайм-проверка в момент обработки первого запроса. Декларация с
   * формой вне этого множества отвергается **на сборке**, до приёма
   * запросов.
   */
  readonly capabilities: TransportCapabilities;

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
