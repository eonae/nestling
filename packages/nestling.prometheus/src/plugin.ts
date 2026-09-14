/**
 * Плагин экспозиции: endpoint `/metrics` поверх store ядра.
 *
 * Своих счётчиков плагин не держит и своего сервера не поднимает: он
 * читает `MetricsStore$` и отдаёт текст на сокете приложения.
 */

import { serialize } from './serialize.js';

import type { MetricsStore, Plugin } from '@nestlingjs/app';
import { makePlugin, MetricsStore$, Ok } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/** Опции плагина экспозиции */
export interface PrometheusOptions {
  /** Адрес экспозиции; по умолчанию `/metrics` */
  readonly path?: string;
}

/** Адрес экспозиции по умолчанию — тот, который сборщик ищет сам */
const DEFAULT_PATH = '/metrics';

/**
 * Подключает экспозицию метрик в формате Prometheus.
 *
 * Второго способа её подключить нет: опций корня плагин не требует, а
 * накопленное держит ядро.
 *
 * @param options - Адрес экспозиции
 * @returns Плагин с одним endpoint'ом
 *
 * @example
 * ```typescript
 * export const app = makeApp({
 *   features: [Orders],
 *   plugins: [makePrometheus()],
 *   transports: [http({ server: api })],
 * });
 * ```
 */
export function makePrometheus(options: PrometheusOptions = {}): Plugin {
  const path = options.path ?? DEFAULT_PATH;

  @Handler([MetricsStore$])
  class MetricsHandler {
    constructor(private readonly store: MetricsStore) {}

    async handle() {
      return new Ok(serialize(this.store.snapshot()));
    }
  }

  return makePlugin({
    name: '@nestlingjs/prometheus',
    endpoints: [
      httpEndpoint.get(path, {
        output: 'text',
        // Метрики снимает сборщик, а не клиент API. Пометки две, потому
        // что и решений два: `detached` снимает endpoint с политик
        // сборки, `doc.hidden` убирает его из документа API
        detached: 'metrics scrape: not part of the application API',
        doc: { hidden: 'service endpoint: metrics exposition' },
        handler: MetricsHandler,
      }),
    ],
  });
}
