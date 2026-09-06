/**
 * `detached` в декларации: обязательность причины, перенос на значение и
 * невыразимость `detached: true`.
 *
 * Пометка — единственная форма opt-out'а из инвариантов сборки, поэтому
 * проверяется там же, где `errors:`: в момент создания значения, до любой
 * сборки приложения.
 */

import { Ok } from '../core/index.js';

import { makeEndpoint } from './endpoint.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';

const HttpTransport$ = makeToken('transport:http');

const reason = 'liveness-проба балансировщика: до auth не доходит';

interface IClock {
  now(): number;
}

describe('detached — причина на значении декларации', () => {
  it('строка переносится на декларацию', () => {
    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      detached: reason,
      handler: async () => new Ok({ status: 'up' }),
    });

    expect(Health.detached).toBe(reason);
  });

  it('причина переживает получение зависимостей', () => {
    class HealthHandler {
      constructor(private readonly clock: IClock) {}

      async handle() {
        return new Ok({ at: this.clock.now() });
      }
    }

    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      detached: reason,
      handler: HealthHandler,
    });

    const resolved = Health.resolve(() => new HealthHandler({ now: () => 0 }));

    expect(resolved.detached).toBe(reason);
  });

  it('декларация без пометки не несёт поля', () => {
    const Health = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'GET /health',
      handler: async () => new Ok({ status: 'up' }),
    });

    expect('detached' in Health).toBe(false);
  });
});

/** Объявление endpoint'а с произвольным `detached` — как это сделал бы JS */
const declare = (detached: unknown) => () =>
  (makeEndpoint as (options: unknown) => unknown)({
    transport: HttpTransport$,
    pattern: 'GET /health',
    detached,
    handler: async () => new Ok({ status: 'up' }),
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
        handler: async () => new Ok({ status: 'up' }),
      }),
    ).toThrow(TypeError);
  });
});
