import type { TransportCapabilities } from '@nestling/pipeline';
import type {
  Dispatch,
  ITransport,
  RouteDeclaration,
} from '@nestling/transport';

/** Способности мока по умолчанию: всё, кроме потоков и файлов */
const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

/**
 * Транспорт-наблюдатель для тестов приложения.
 *
 * Держит полученный `dispatch`: тест видит и маршруты, которые ему
 * достались, и может исполнить endpoint, не поднимая сокета.
 */
export class MockTransport implements ITransport {
  /** Маршруты, полученные в `serve`. До старта приёма запросов список пуст */
  routes: readonly RouteDeclaration[] = [];

  /** Диспетчер: единственный способ исполнить endpoint */
  dispatch?: Dispatch;

  serving = false;
  closed = false;

  /** Сигнал остановки, полученный в `serve` */
  signal?: AbortSignal;

  readonly capabilities: TransportCapabilities;

  constructor(
    private readonly onClose?: () => void,
    capabilities: TransportCapabilities = VALUE_ONLY,
  ) {
    this.capabilities = capabilities;
  }

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.routes = dispatch.routes;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.serving = false;
    this.closed = true;
    this.onClose?.();
  }
}
