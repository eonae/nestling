/**
 * `httpProbes()` — плагин проб: два endpoint'а поверх узла ядра `Health$`.
 *
 * Правило «когда приложение готово» живёт в ядре: итог, таймаут и кэш
 * принадлежат `Health$`. Пакету принадлежат только адреса и коды ответа.
 *
 * Оба endpoint'а объявлены без пайплайна, `detached` и `doc.hidden`: пробу
 * зовёт балансировщик, а не клиент API, поэтому ни слоя авторизации, ни
 * строки в документе ей не нужно.
 */

import { httpEndpoint } from './helpers.js';

import type { StandardSchemaV1 } from '@common/misc';
import type { Health, HealthReport, Plugin } from '@nestling/app';
import { Health$, makeFail, makePlugin, Ok } from '@nestling/app';
import { Handler } from '@nestling/container';

/** Причина, по которой пробы выведены из-под инвариантов сборки */
const REASON = 'проба балансировщика: до пайплайна приложения не доходит';

/**
 * Схема деталей отказа: отчёт проходит как есть.
 *
 * Написана руками, как схемы kernel-секций: отчёт строит ядро этим же
 * процессом, и проверять его вендорной схемой значило бы проверять
 * собственный тип.
 */
const reportSchema: StandardSchemaV1<unknown, HealthReport> = {
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => ({ value: value as HealthReport }),
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
   * на нём: `httpProbes({ on: 'admin' })`.
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
 *   plugins: [httpProbes()],
 *   transports: [http()],
 * });
 * ```
 */
export function httpProbes(options: HttpProbesOptions = {}): Plugin {
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
    name: '@nestling/transport.http/probes',
    endpoints: [
      httpEndpoint({
        method: 'GET',
        path: liveness,
        ...(on === undefined ? {} : { on }),
        detached: REASON,
        doc: { hidden: REASON },
        handler: LivenessHandler,
      }),
      httpEndpoint({
        method: 'GET',
        path: readiness,
        ...(on === undefined ? {} : { on }),
        errors: [NotReady],
        detached: REASON,
        doc: { hidden: REASON },
        handler: ReadinessHandler,
      }),
    ],
  });
}
