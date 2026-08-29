/**
 * Транспорт-фикстура интеграционных тестов.
 *
 * Своего транспорта пакету не нужно, а брать HTTP ради `events`-endpoint'а —
 * лишняя зависимость в тесте: способности объявляются значением, поэтому
 * фикстура их просто перечисляет.
 */

import type { Provider, TokenString } from '@nestling/container';
import { makeToken, valueProvider } from '@nestling/container';
import type { TransportCapabilities } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/** Транспорт умеет и значения, и потоки: подписка — его штатная форма */
const STREAMING: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value', 'stream', 'events']),
};

/** Токен транспорта тестов */
export const TestTransport$: TokenString<ITransport> =
  makeToken<ITransport>('transport:test');

/** Транспорт, который никуда не выходит: старта приёма запросов и нет */
export class TestTransport implements ITransport {
  serving = false;
  closed = false;

  /** Появилось бы на старте приёма запросов — в тестовом прогоне пусто */
  dispatch?: Dispatch;
  signal?: AbortSignal;

  readonly capabilities: TransportCapabilities = STREAMING;

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Провайдер транспорта для словаря `transports:` */
export const testTransport = (): Provider<ITransport> =>
  valueProvider<ITransport>(TestTransport$, new TestTransport());
