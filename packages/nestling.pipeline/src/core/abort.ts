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
 * Вычисляет исход выполнения для `.finally`-юнитов (семантика v1:
 * после ответной фазы, до фактической отправки транспортом).
 */
export function computeOutcome(
  signal: AbortSignal,
  response: ResponseContext,
): Outcome {
  if (signal.aborted) {
    return signal.reason instanceof ClientDisconnectedError
      ? 'disconnected'
      : 'aborted';
  }

  return response.isSuccess ? 'completed' : 'failed';
}
