/**
 * Наблюдаемость вызова порта: счётчик и длительность на обеих формах
 * вызывателя.
 *
 * Обёртка живёт в узле порта, а не в реализации: вызыватель знает
 * операцию, её вид и выбранный биндинг, и он один видит оба пути. Поэтому
 * набор метрик у `local-first` и `always-remote` одинаков, а различает их
 * атрибут `binding`.
 */

import type { CallAttributes, KernelMetricsWriter } from '../metrics/index.js';

import type { AnyOperation, Emitter, Port } from '@nestlingjs/operations';
import { isFail } from '@nestlingjs/operations';

/** Путь биндинга: через `dispatch` или через шину */
export type PortBinding = 'local' | 'remote';

/** Постоянные атрибуты вызывателя: всё, что известно при сборке узла */
const attributesOf = (
  operation: AnyOperation,
  binding: PortBinding,
): Omit<CallAttributes, 'outcome'> => ({
  operation: operation.name,
  kind: operation.kind,
  binding,
});

/** Пишет счётчик и длительность одного вызова */
function record(
  metrics: KernelMetricsWriter,
  base: Omit<CallAttributes, 'outcome'>,
  outcome: CallAttributes['outcome'],
  durationMs: number,
): void {
  const attributes = { ...base, outcome };

  metrics['port.calls'].add(1, attributes);
  metrics['port.duration'].record(durationMs, attributes);
}

/**
 * Оборачивает вызыватель `request`-операции.
 *
 * Объявленный отказ и брошенная ошибка дают один исход `failed`: для
 * наблюдателя вызов не удался в обоих случаях.
 */
export function observePort(
  port: Port<any>,
  operation: AnyOperation,
  binding: PortBinding,
  metrics: KernelMetricsWriter,
): Port<any> {
  const base = attributesOf(operation, binding);

  return {
    async call(payload?: unknown, meta?: never) {
      const startedAt = performance.now();

      try {
        const result = await port.call(payload, meta);

        record(
          metrics,
          base,
          isFail(result) ? 'failed' : 'completed',
          performance.now() - startedAt,
        );

        return result;
      } catch (error) {
        record(metrics, base, 'failed', performance.now() - startedAt);

        throw error;
      }
    },
  };
}

/**
 * Оборачивает эмиттер `command`/`event`-операции.
 *
 * Исход берётся из самого `emit`: он резолвится по факту доставки, а
 * отказ подписчика вызывающему не всплывает — и в метрику вызывателя не
 * попадает тоже.
 */
export function observeEmitter(
  emitter: Emitter<any>,
  operation: AnyOperation,
  binding: PortBinding,
  metrics: KernelMetricsWriter,
): Emitter<any> {
  const base = attributesOf(operation, binding);

  return {
    async emit(payload?: unknown, meta?: never) {
      const startedAt = performance.now();

      try {
        await emitter.emit(payload, meta);

        record(metrics, base, 'completed', performance.now() - startedAt);
      } catch (error) {
        record(metrics, base, 'failed', performance.now() - startedAt);

        throw error;
      }
    },
  };
}
