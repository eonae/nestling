/**
 * Отказы комбинаторов — **обычные ошибки без транспортной семантики**.
 *
 * Пакет не знает ни про статусы, ни про `Fail`: пайплайн передаёт свои
 * фабрики (`onExceeded`/`onTimeout`), и тогда наружу летят kernel-отказы
 * `payload_too_large` / `timeout`. Эти классы — дефолт для
 * satellite-кода, который применяет комбинаторы к своим потокам.
 */

/** Поток отдал больше элементов, чем разрешает `.limit(max)` */
export class StreamLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Stream limit of ${limit} item(s) exceeded`);
    this.name = 'StreamLimitError';
  }
}

/** Источник молчал дольше, чем разрешает `.gapTimeout(ms)` */
export class StreamGapTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Stream produced no item within ${ms}ms`);
    this.name = 'StreamGapTimeoutError';
  }
}
