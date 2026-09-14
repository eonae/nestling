/**
 * `makeHttpProbes()` — плагин проб: два endpoint'а поверх узла ядра `Health$`.
 *
 * Правило «когда приложение готово» живёт в ядре: итог, таймаут и кэш
 * принадлежат `Health$`. Пакету принадлежат только адреса и коды ответа.
 *
 * Оба endpoint'а объявлены без пайплайна, `detached` и `doc.hidden`: пробу
 * зовёт балансировщик, а не клиент API, поэтому ни слоя авторизации, ни
 * строки в документе ей не нужно.
 */

import { httpEndpoint } from './helpers.js';

import type {
  Health,
  HealthReport,
  LivenessReport,
  Plugin,
} from '@nestlingjs/app';
import { Health$, makeFail, makePlugin, Ok } from '@nestlingjs/app';
import type { StandardSchemaV1 } from '@nestlingjs/common.misc';
import { Handler } from '@nestlingjs/container';

/** Причина, по которой пробы выведены из-под инвариантов сборки */
const REASON = 'load balancer probe: never reaches the application pipeline';

/**
 * Схема деталей отказа: отчёт проходит как есть.
 *
 * Написана руками — редкий случай, когда вендорская схема не подходит.
 * Причина не в нейтральности: отчёт строит этот же процесс, и схема не
 * проверяет ничего. Вендорская запись такого значения это `z.custom<T>()`,
 * а он непредставим в JSON Schema, то есть стоил бы аннотации ради
 * проверки, которой нет.
 */
const reportSchema: StandardSchemaV1<unknown, HealthReport> = {
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => ({ value: value as HealthReport }),
  },
};

/** Схема тела liveness-пробы; собрана так же, как {@link reportSchema} */
const livenessSchema: StandardSchemaV1<unknown, LivenessReport> = {
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => ({ value: value as LivenessReport }),
  },
};

/**
 * Приложение не готово принимать трафик.
 *
 * Категория `service_unavailable` превращается транспортом в 503. Отказ
 * задекларирован в `errors:`, поэтому `details` уходит клиенту при любой
 * политике раскрытия — тело пробы и должно нести отчёт.
 */
export const NotReady = makeFail('service_unavailable:not_ready', {
  details: reportSchema,
  message: 'Service is not ready',
});

/** Опции плагина проб: адреса, по которым их зовёт окружение */
export interface HttpProbesOptions {
  /** Путь liveness-пробы; по умолчанию `/healthz` */
  readonly liveness?: string;

  /** Путь readiness-пробы; по умолчанию `/readyz` */
  readonly readiness?: string;

  /**
   * Имя экземпляра HTTP-транспорта, который обслуживает пробы.
   *
   * По умолчанию `'default'`. Приложение с админским портом отдаёт пробы
   * на нём: `makeHttpProbes({ on: 'admin' })`.
   */
  readonly on?: string;
}

/**
 * Плагин с двумя пробами: `GET /healthz` и `GET /readyz`.
 *
 * Провайдеров не объявляет: узел ядра уже в графе у любого приложения.
 *
 * @param options - Адреса проб и экземпляр транспорта
 * @returns Значение-плагин для `plugins:` корня
 *
 * @example
 * ```typescript
 * makeApp({
 *   features: [UsersFeature],
 *   plugins: [makeHttpProbes()],
 *   transports: [http()],
 * });
 * ```
 */
export function makeHttpProbes(options: HttpProbesOptions = {}): Plugin {
  const { liveness = '/healthz', readiness = '/readyz', on } = options;

  @Handler([Health$])
  class LivenessHandler {
    constructor(private readonly health: Health) {}

    async handle() {
      return new Ok(this.health.liveness());
    }
  }

  @Handler([Health$])
  class ReadinessHandler {
    constructor(private readonly health: Health) {}

    async handle(_payload: unknown, meta: { signal: AbortSignal }) {
      const report = await this.health.readiness(meta.signal);

      // Перечень успешных статусов закрыт, и 503 в нём нет: неготовность
      // выражается задекларированным отказом, а не `Ok` с 5xx
      return report.status === 'ready' ? new Ok(report) : NotReady(report);
    }
  }

  return makePlugin({
    name: '@nestlingjs/transport.http/probes',
    endpoints: [
      httpEndpoint.get(liveness, {
        ...(on === undefined ? {} : { on }),
        // Тело пробы — отчёт: выход объявлен схемой, которая пропускает
        // его как есть
        output: livenessSchema,
        detached: REASON,
        doc: { hidden: REASON },
        handler: LivenessHandler,
      }),
      httpEndpoint.get(readiness, {
        ...(on === undefined ? {} : { on }),
        output: reportSchema,
        errors: [NotReady],
        detached: REASON,
        doc: { hidden: REASON },
        handler: ReadinessHandler,
      }),
    ],
  });
}
