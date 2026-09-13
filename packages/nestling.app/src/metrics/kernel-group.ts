/**
 * Группа метрик ядра: четыре метрики с префиксом `nestling`.
 *
 * Ядро объявляет их тем же механизмом, что и приложение, поэтому
 * приложение адресует метрику ядра членом группы, а не строкой.
 *
 * Атрибуты `transport`, `pattern` и `operation` объявлены открытыми:
 * значения им даёт состав деклараций, известный только сборке. Ряды по
 * ним заводит {@link kernelSeries} — парами, а не произведением: endpoint
 * `GET /users` есть у своего транспорта, а не у каждого.
 */

import type { SeriesResolutions } from './catalog.js';
import type { AttributesOf, MetricsOf } from './declaration.js';
import { counter, histogram, makeMetrics, open } from './declaration.js';
import type { MetricAttributes } from './sink.js';

/** Исходы обработки запроса — те же, что видит `.finally`-шаг */
const REQUEST_OUTCOMES = [
  'completed',
  'disconnected',
  'aborted',
  'failed',
] as const;

/** Исходы вызова порта: объявленный отказ и брошенная ошибка — один исход */
const CALL_OUTCOMES = ['completed', 'failed'] as const;

/** Виды операций */
const OPERATION_KINDS = ['request', 'command', 'event'] as const;

/** Пути биндинга: через `dispatch` или через шину */
const BINDINGS = ['local', 'remote'] as const;

/**
 * Границы корзин длительности, мс.
 *
 * Ряд границ покрывает и in-proc вызов, и запрос через сеть: от доли
 * миллисекунды до нескольких секунд.
 */
const DURATION_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
] as const;

/** Атрибуты метрик обработки запроса */
const REQUEST_ATTRIBUTES = {
  transport: open,
  pattern: open,
  outcome: REQUEST_OUTCOMES,
} as const;

/** Атрибуты метрик вызова порта */
const CALL_ATTRIBUTES = {
  operation: open,
  kind: OPERATION_KINDS,
  binding: BINDINGS,
  outcome: CALL_OUTCOMES,
} as const;

/**
 * Метрики ядра: обработка запроса и вызов порта.
 *
 * Группа входит в каталог любой сборки: её вклад приходит kernel-модулем,
 * а не выбором приложения.
 */
export const KernelMetrics = makeMetrics('nestling', {
  requests: counter({
    help: 'Handled requests',
    attributes: REQUEST_ATTRIBUTES,
  }),

  'request.duration': histogram({
    help: 'Request handling duration',
    unit: 'ms',
    buckets: DURATION_BUCKETS,
    attributes: REQUEST_ATTRIBUTES,
  }),

  'port.calls': counter({
    help: 'Port invocations',
    attributes: CALL_ATTRIBUTES,
  }),

  'port.duration': histogram({
    help: 'Port invocation duration',
    unit: 'ms',
    buckets: DURATION_BUCKETS,
    attributes: CALL_ATTRIBUTES,
  }),
});

/** Писатель группы ядра: его получает рантайм пайплайна и узел порта */
export type KernelMetricsWriter = MetricsOf<typeof KernelMetrics>;

/** Атрибуты записи об обработке запроса */
export type RequestAttributes = AttributesOf<typeof REQUEST_ATTRIBUTES>;

/** Атрибуты записи о вызове порта */
export type CallAttributes = AttributesOf<typeof CALL_ATTRIBUTES>;

/** Endpoint сборки глазами метрик: транспорт и шаблон маршрута */
export interface MetricEndpoint {
  /** Имя транспорта */
  readonly transport: string;

  /** Шаблон маршрута из декларации */
  readonly pattern: string;
}

/** Операция сборки глазами метрик: имя и вид */
export interface MetricOperation {
  /** Имя операции — её адрес на интеркоме */
  readonly name: string;

  /** Вид операции */
  readonly kind: string;
}

/**
 * Ряды метрик ядра по составу сборки.
 *
 * Обе пары метрик получают ряды до первого запроса, поэтому экспозиция
 * свежеподнятого приложения показывает нули по каждому endpoint'у,
 * каждой операции и каждому исходу.
 *
 * @param endpoints - Обнаруженные endpoint'ы сборки
 * @param operations - Операции, которые эта сборка вызывает
 * @returns Ряды по полному имени метрики
 */
export function kernelSeries(
  endpoints: readonly MetricEndpoint[],
  operations: readonly MetricOperation[],
): SeriesResolutions {
  const requests: MetricAttributes[] = [];
  const calls: MetricAttributes[] = [];

  for (const { transport, pattern } of endpoints) {
    for (const outcome of REQUEST_OUTCOMES) {
      requests.push({ transport, pattern, outcome });
    }
  }

  for (const { name, kind } of operations) {
    for (const binding of BINDINGS) {
      for (const outcome of CALL_OUTCOMES) {
        calls.push({ operation: name, kind, binding, outcome });
      }
    }
  }

  return new Map([
    ['nestling.requests', requests],
    ['nestling.request.duration', requests],
    ['nestling.port.calls', calls],
    ['nestling.port.duration', calls],
  ]);
}
