/**
 * Well-known ambient-переменные ядра.
 *
 * Их две, и обе — по необходимости: сигнал отмены живёт вне `input` и
 * поэтому не может быть объявлен пользовательским кодом, а `requestId`
 * поставляется штатным юнитом наблюдаемости и обязан быть той же
 * переменной, что назовёт политика.
 */

import type { ContextVar, ReadonlyContextVar } from './variable.js';
import { contextVar, readonlyContextVar, SIGNAL_KEY } from './variable.js';

/**
 * Сигнал отмены запроса для кода любой глубины.
 *
 * Read-only: значение берётся из контекста запроса, а не из `input`, —
 * писать в него нечем ни по типам, ни в рантайме.
 *
 * @example
 * ```typescript
 * @Injectable([Ctx(Signal)])
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
