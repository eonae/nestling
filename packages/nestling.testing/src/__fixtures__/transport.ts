import type { TransportCapabilities } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/**
 * Способности фикстуры: те же формы входа, что у HTTP, кроме потоковых.
 *
 * `multipart` нужен тесту, который сверяет проверку входа через `app.call`
 * с поведением транспорта; потоков тестам пакета по-прежнему не нужно.
 */
const HTTP_LIKE: TransportCapabilities = {
  input: new Set(['value', 'multipart']),
  output: new Set(['value']),
};

/**
 * Транспорт-наблюдатель: тестовый прогон обязан **не** звать его `serve`.
 *
 * Существует ради отрицательного утверждения — «сокет не открыт»: без
 * инстанса, на котором виден старт приёма запросов, это утверждение было бы
 * непроверяемым.
 */
export class SpyTransport implements ITransport {
  serving = false;
  closed = false;

  /**
   * Значения, которые получил бы транспорт при старте приёма запросов.
   * В тестовом прогоне остаются пустыми
   */
  dispatch?: Dispatch;
  signal?: AbortSignal;

  readonly capabilities: TransportCapabilities = HTTP_LIKE;

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
