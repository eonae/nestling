/**
 * Имена метрик, которые пишет ядро.
 *
 * Значения, а не строки по месту: их называет документация, их же читает
 * тест, и расхождение между двумя списками невозможно.
 */

/** Метрики ядра: обработка запроса и вызов порта */
export const KERNEL_METRICS = {
  /** Счётчик обработанных запросов */
  requests: 'nestling.requests',

  /** Длительность обработки запроса, мс */
  requestDuration: 'nestling.request.duration',

  /** Счётчик вызовов порта */
  portCalls: 'nestling.port.calls',

  /** Длительность вызова порта, мс */
  portDuration: 'nestling.port.duration',
} as const;
