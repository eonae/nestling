/**
 * Стартовый контекст запроса: `makeEmptyContext` и его четвёртый параметр —
 * стартовый input, через который транспорт кладёт в контекст то, что знает
 * до первого pre-юнита (сырые байты тела при `rawBody: true`).
 */

import type { EndpointMeta } from './context';
import { makeEmptyContext } from './context';
import type { Raw } from './raw';

import { describe, expect, it } from '@jest/globals';

const raw: Raw = {
  transport: 'http',
  pattern: 'POST /hooks',
  payload: undefined,
  attributes: {},
};

const endpoint: EndpointMeta = { transport: 'http', pattern: 'POST /hooks' };

describe('makeEmptyContext', () => {
  it('без стартового input даёт пустой input', () => {
    const ctx = makeEmptyContext(raw, endpoint);

    expect(ctx.input).toEqual({});
    expect(ctx.raw).toBe(raw);
    expect(ctx.endpoint).toBe(endpoint);
  });

  it('без сигнала подставляет never-aborted', () => {
    const ctx = makeEmptyContext(raw, endpoint);

    expect(ctx.signal.aborted).toBe(false);
  });

  it('стартовый input попадает в контекст и типизирует его', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const signal = new AbortController().signal;

    const ctx = makeEmptyContext(raw, endpoint, signal, { rawBody: bytes });

    // Тип контекста — ExtendableContext<{ rawBody: Uint8Array }>:
    // поле доступно без сужений.
    const seen: Uint8Array = ctx.input.rawBody;

    expect(seen).toBe(bytes);
    expect(ctx.signal).toBe(signal);
  });
});
