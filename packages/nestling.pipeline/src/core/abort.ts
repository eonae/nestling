import type { ResponseContext } from './types/context.js';
import type { Outcome } from './types/unit.js';

/**
 * Причина аборта «клиент отвалился». Транспорты взводят per-request
 * сигнал этой причиной при закрытии соединения до завершения ответа.
 */
export class ClientDisconnectedError extends Error {
  constructor() {
    super('client disconnected');
    this.name = 'ClientDisconnectedError';
  }
}

/**
 * Причина аборта «транспорт останавливается» (graceful shutdown).
 */
export class TransportClosingError extends Error {
  constructor() {
    super('transport closing');
    this.name = 'TransportClosingError';
  }
}

/**
 * Вычисляет исход выполнения для `.finally`-юнитов.
 *
 * Для не-потоковой формы `output` зовётся сразу после ответной фазы; для
 * потоковой — из обёртки завершения, когда поток дотёк, оборвался или был
 * закрыт потребителем. Вид формы отдельным аргументом не нужен: различие
 * `stream`/`events` уже выражено сигналом — «нормальное завершение
 * подписки» это и есть дисконнект, взводящий `ClientDisconnectedError`, а
 * источник, закончившийся сам, даёт `completed` и для `events`.
 *
 * @param streamFailed - поток оборвался ошибкой (для потоковых форм);
 * ответная фаза при этом уже завершилась успехом, поэтому по `response`
 * отказ не виден
 */
export function computeOutcome(
  signal: AbortSignal,
  response: ResponseContext,
  streamFailed = false,
): Outcome {
  if (signal.aborted) {
    return signal.reason instanceof ClientDisconnectedError
      ? 'disconnected'
      : 'aborted';
  }

  if (streamFailed) {
    return 'failed';
  }

  return response.isSuccess ? 'completed' : 'failed';
}
