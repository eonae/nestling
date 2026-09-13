/**
 * Well-known ambient-переменные ядра.
 *
 * Их три, и каждая — по необходимости: сигнал отмены живёт вне `input` и
 * поэтому не может быть объявлен пользовательским кодом, а `requestId` и
 * трасса поставляются штатными шагами наблюдаемости и обязаны быть теми
 * же переменными, что назовёт политика.
 */

import type {
  ContextVar,
  PropagatedContextVar,
  ReadonlyContextVar,
} from './variable.js';
import {
  contextVar,
  kernelContextVar,
  readonlyContextVar,
  SIGNAL_KEY,
  TRACE_KEY,
} from './variable.js';

/**
 * Сигнал отмены запроса для кода любой глубины.
 *
 * Read-only: значение берётся из контекста запроса, а не из `input`, —
 * писать в него нечем ни по типам, ни в рантайме.
 *
 * @example
 * ```typescript
 * @Component([Ctx(Signal)])
 * export class UpstreamClient {
 *   constructor(private readonly signal: CtxReader<AbortSignal>) {}
 *
 *   fetchAll() {
 *     return fetch(url, { signal: this.signal.get() });
 *   }
 * }
 * ```
 */
export const Signal: ReadonlyContextVar<AbortSignal, typeof SIGNAL_KEY> =
  readonlyContextVar<AbortSignal, typeof SIGNAL_KEY>(SIGNAL_KEY);

/**
 * Идентификатор запроса — переменная штатного слоя наблюдаемости
 * ({@link withRequestId}).
 *
 * Экспортируется значением, потому что политика адресует **это** значение:
 * одноимённая переменная из соседнего файла её не удовлетворит.
 */
export const RequestId: ContextVar<string, 'requestId'> =
  contextVar<string>()('requestId');

/**
 * Трасса запроса: идентификатор всей цепочки, идентификатор её участка и
 * флаг выборки.
 *
 * Значение — объект, а не строка `traceparent`: прикладной код читает
 * `traceId` через `Ctx(Trace)`, не разбирая формат. Строка W3C остаётся
 * формой передачи по HTTP.
 */
export interface TraceContext {
  /** Идентификатор трассы: 32 шестнадцатеричных знака */
  readonly traceId: string;

  /** Идентификатор участка трассы: 16 шестнадцатеричных знаков */
  readonly spanId: string;

  /** Идентификатор участка, породившего этот; у начала трассы его нет */
  readonly parentSpanId?: string;

  /** Родитель пометил трассу к записи */
  readonly sampled: boolean;
}

/**
 * Трасса запроса — переменная штатного слоя наблюдаемости
 * ({@link withTracing}).
 *
 * Провозимая: вызыватель порта кладёт значение в конверт шины, а
 * получатель — в `ctx.raw.attributes`, откуда его читает `withTracing()`
 * на той стороне.
 *
 * @example
 * ```typescript
 * @Component([Ctx(Trace)])
 * export class AuditTrail {
 *   constructor(private readonly trace: CtxReader<TraceContext>) {}
 *
 *   record(action: string) {
 *     return this.store.put({ action, traceId: this.trace.get().traceId });
 *   }
 * }
 * ```
 */
export const Trace: PropagatedContextVar<TraceContext, typeof TRACE_KEY> =
  kernelContextVar<TraceContext>()(TRACE_KEY, { propagate: true });
