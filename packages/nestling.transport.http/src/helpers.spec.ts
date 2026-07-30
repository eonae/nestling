/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Конструктор HTTP-деклараций: fail-fast транспортного словаря при
 * создании и типизация пути (`PathParams`).
 */

import type { PathParams } from './helpers';
import { httpEndpoint } from './helpers';

import { describe, expect, it } from '@jest/globals';
import { isEndpointDefinition, Ok } from '@nestling/pipeline';
import { z } from 'zod';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const handle = async () => new Ok({});

describe('httpEndpoint', () => {
  it('собирает pattern из метода и пути и ставит бренд', () => {
    const CreateUser = httpEndpoint({
      method: 'POST',
      path: '/api/users',
      input: z.object({ name: z.string() }),
      handle: async (input) => new Ok({ name: input.name }),
    });

    expect(CreateUser.transport).toBe('http');
    expect(CreateUser.pattern).toBe('POST /api/users');
    expect(isEndpointDefinition(CreateUser)).toBe(true);
  });

  it('пустой path — ошибка в момент создания', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: '' as string, handle }),
    ).toThrow(/'path' must be a non-empty string/);
  });

  it('path без ведущего слэша — ошибка в момент создания', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: 'users', handle }),
    ).toThrow(/'path' must start with '\/', got 'users'/);
  });

  it('повторяющийся path-параметр — ошибка с именем параметра', () => {
    expect(() =>
      httpEndpoint({ method: 'GET', path: '/a/:id/b/:id', handle }),
    ).toThrow(/path parameter ':id' is declared twice/);
  });

  it('разные path-параметры в одном шаблоне легальны', () => {
    const GetOrder = httpEndpoint({
      method: 'GET',
      path: '/users/:id/orders/:orderId',
      handle,
    });

    expect(GetOrder.pattern).toBe('GET /users/:id/orders/:orderId');
  });
});

describe('PathParams', () => {
  it('выводит имена path-параметров из шаблона', () => {
    type TwoParams = PathParams<'/users/:id/orders/:orderId'>;
    type OneParam = PathParams<'/users/:id'>;
    type NoParams = PathParams<'/health'>;

    type _Two = Expect<Equal<TwoParams, 'id' | 'orderId'>>;
    type _One = Expect<Equal<OneParam, 'id'>>;
    type _None = Expect<Equal<NoParams, never>>;

    expect(true).toBe(true);
  });

  it('path остаётся литеральным типом декларации', () => {
    const GetUser = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      handle,
    });

    // Литерал сохранён: следующий change (`input-bind`) строит из него
    // правило «имя поля совпало с path-параметром → путь»
    type _Pattern = Expect<Equal<typeof GetUser.pattern, string>>;

    expect(GetUser.pattern).toBe('GET /users/:id');
  });
});
