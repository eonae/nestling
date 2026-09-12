/**
 * Формат W3C trace-context: разбор и сборка строки `traceparent`.
 *
 * Ядро держит трассу объектом ({@link TraceContext}), а строка остаётся
 * формой передачи по HTTP. Разбор снисходителен: значение приходит из-за
 * границы доверия и схемы не имеет, поэтому непонятная строка даёт
 * `undefined`, а не исключение.
 */

import type { TraceContext } from './well-known.js';

/** Единственная версия формата, которую ядро читает и пишет */
const VERSION = '00';

/** Длина `traceId` в шестнадцатеричных знаках */
const TRACE_ID_LENGTH = 32;

/** Длина `spanId` в шестнадцатеричных знаках */
const SPAN_ID_LENGTH = 16;

/** Бит `sampled` в поле флагов */
const SAMPLED_FLAG = 0b0000_0001;

/** Шестнадцатеричная строка заданной длины, не состоящая из одних нулей */
const isHexId = (value: string, length: number): boolean =>
  value.length === length && /^[\da-f]+$/.test(value) && !/^0+$/.test(value);

/** Случайные байты шестнадцатеричной строкой */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);

  let out = '';
  for (const byte of buffer) {
    out += byte.toString(16).padStart(2, '0');
  }

  return out;
}

/** Новый идентификатор трассы: 16 случайных байт */
export const newTraceId = (): string => randomHex(TRACE_ID_LENGTH / 2);

/** Новый идентификатор участка трассы: 8 случайных байт */
export const newSpanId = (): string => randomHex(SPAN_ID_LENGTH / 2);

/**
 * Разбирает строку `traceparent`.
 *
 * @param value - Значение заголовка; чем угодно, включая не строку
 * @returns Родительский контекст или `undefined`, если строку не понять
 */
export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parts = value.trim().toLowerCase().split('-');

  if (parts.length !== 4) {
    return undefined;
  }

  const [version, traceId, spanId, flags] = parts;

  if (version !== VERSION) {
    return undefined;
  }

  if (!isHexId(traceId, TRACE_ID_LENGTH) || !isHexId(spanId, SPAN_ID_LENGTH)) {
    return undefined;
  }

  if (flags.length !== 2 || !/^[\da-f]+$/.test(flags)) {
    return undefined;
  }

  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & SAMPLED_FLAG) !== 0,
  };
}

/**
 * Собирает строку `traceparent` из трассы.
 *
 * Идентификатор участка берётся собственный, а не родительский: получатель
 * станет ребёнком того участка, который отправляет запрос.
 */
export const formatTraceparent = (trace: TraceContext): string =>
  `${VERSION}-${trace.traceId}-${trace.spanId}-${trace.sampled ? '01' : '00'}`;

/**
 * Признаёт значение трассой, привезённой шиной.
 *
 * Провозимое значение схемы не имеет, поэтому проверяются те же
 * инварианты, что у разобранной строки: длины идентификаторов и вид
 * знаков.
 */
export function parsePropagatedTrace(value: unknown): TraceContext | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const { traceId, spanId, sampled } = value as Partial<TraceContext>;

  if (typeof traceId !== 'string' || typeof spanId !== 'string') {
    return undefined;
  }

  if (!isHexId(traceId, TRACE_ID_LENGTH) || !isHexId(spanId, SPAN_ID_LENGTH)) {
    return undefined;
  }

  return { traceId, spanId, sampled: sampled === true };
}
