import type {
  Dispatch,
  ITransport,
  RouteDeclaration,
} from '../transport/index.js';

/**
 * Транспорт-наблюдатель для тестов приложения.
 *
 * Держит полученный `dispatch`: тест видит и маршруты, которые ему
 * достались, и может исполнить endpoint, не поднимая сокета.
 *
 * Способностей у него нет: формы io объявляет `transportValue(...)`, как у
 * любого транспорта.
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

  constructor(private readonly onClose?: () => void) {}

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
