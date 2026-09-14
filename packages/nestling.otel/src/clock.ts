/**
 * Часы сателлита: отметка времени в форме, которую понимает OpenTelemetry.
 *
 * `HrTime` — пара «секунды от эпохи» и «наносекунды внутри секунды».
 * Отметка берётся от `performance`, поэтому два вызова подряд различимы:
 * `Date.now()` даёт целые миллисекунды, и участок короче миллисекунды
 * получил бы нулевую длительность.
 */

import type { HrTime } from '@opentelemetry/api';

/** Наносекунд в секунде */
const NANOS_PER_SECOND = 1e9;

/** Наносекунд в миллисекунде */
const NANOS_PER_MILLI = 1e6;

/** Пара с наносекундами внутри секунды: перенос целой секунды вверх */
function normalize(seconds: number, nanos: number): HrTime {
  const carry = Math.floor(nanos / NANOS_PER_SECOND);

  return [seconds + carry, nanos - carry * NANOS_PER_SECOND];
}

/**
 * Текущее время.
 *
 * @returns Отметка в форме `HrTime`
 */
export function now(): HrTime {
  const epochMillis = performance.timeOrigin + performance.now();
  const seconds = Math.floor(epochMillis / 1000);
  const nanos = Math.round((epochMillis - seconds * 1000) * NANOS_PER_MILLI);

  return normalize(seconds, nanos);
}

/**
 * Разность двух отметок.
 *
 * @param from - Начало интервала
 * @param to - Конец интервала
 * @returns Длительность в форме `HrTime`
 */
export function since(from: HrTime, to: HrTime): HrTime {
  return normalize(to[0] - from[0], to[1] - from[1]);
}
