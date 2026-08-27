/**
 * `detached` в декларации: обязательность причины, перенос на значение и
 * невыразимость `detached: true`.
 *
 * Пометка — единственная форма opt-out'а из инвариантов сборки, поэтому
 * проверяется там же, где `errors:`: в момент создания значения, до любой
 * сборки приложения.
 */

import { Ok } from '../core';

import { makeEndpoint } from './endpoint';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';

const HttpTransport$ = makeToken('transport:http');

const reason = 'liveness-проба балансировщика: до auth не доходит';

interface IClock {
  now(): number;
}

const IClock$ = makeToken<IClock>('IClock');

describe('detached — причина на значении декларации', () => {
  it('строка переносится на декларацию', () => {
    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      detached: reason,
      handle: async () => new Ok({ status: 'up' }),
    });

    expect(Health.detached).toBe(reason);
  });

  it('причина переживает гашение зависимостей', () => {
    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      detached: reason,
      deps: [IClock$],
      handle: (clock: IClock) => async () => new Ok({ at: clock.now() }),
    });

    const resolved = Health.resolve(() => ({ now: () => 0 }));

    expect(resolved.detached).toBe(reason);
  });

  it('декларация без пометки не несёт поля', () => {
    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      handle: async () => new Ok({ status: 'up' }),
    });

    expect('detached' in Health).toBe(false);
  });
});

/** Объявление ручки с произвольным `detached` — как это сделал бы JS */
const declare = (detached: unknown) => () =>
  (makeEndpoint as (options: unknown) => unknown)({
    transport: HttpTransport$,
    pattern: 'GET /health',
    detached,
    handle: async () => new Ok({ status: 'up' }),
  });

describe('detached — fail-fast в точке создания', () => {
  it('пустая строка отвергается', () => {
    expect(declare('')).toThrow(
      /GET \/health.*'detached' must state a reason/s,
    );
  });

  it('строка из пробелов отвергается', () => {
    expect(declare('   ')).toThrow(/'detached' must state a reason/);
  });

  it('не-строка отвергается, и текст называет отсутствие detached: true', () => {
    expect(declare(true)).toThrow(TypeError);
    expect(declare(true)).toThrow(/There is no 'detached: true'/);
  });
});

describe('detached — типы', () => {
  it('detached: true невыразим по типам и отвергается рантаймом', () => {
    expect(() =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'GET /health',
        // @ts-expect-error: причина обязана быть строкой — `true` не форма opt-out'а
        detached: true,
        handle: async () => new Ok({ status: 'up' }),
      }),
    ).toThrow(TypeError);
  });
});
