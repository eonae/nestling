import type { TransportCapabilities } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/** Способности фикстуры: только value-формы — потоков тестам не нужно */
const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value']),
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

  readonly capabilities: TransportCapabilities = VALUE_ONLY;

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
