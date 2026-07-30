/**
 * Типовой тест контракта транспорта: `endpoint()` принимает только
 * исполнимую декларацию (`TNeeds = never`) — симметрично тому, как
 * pipeline принимает только `Pipeline<_, _, never>`.
 */

import type { ITransport } from './interfaces';

import { describe, expect, it } from '@jest/globals';
import { makeEndpoint, Ok } from '@nestling/pipeline';

class UserService {
  getAll() {
    return [];
  }
}

const DepsFree = makeEndpoint({
  transport: 'test',
  pattern: 'GET /ping',
  handle: async () => new Ok({ pong: true }),
});

const WithDeps = makeEndpoint({
  transport: 'test',
  pattern: 'GET /users',
  deps: [UserService],
  handle: (users) => async () => new Ok(users.getAll()),
});

describe('ITransport.endpoint', () => {
  const received: string[] = [];

  const transport: ITransport = {
    endpoint(definition) {
      received.push(definition.pattern);
    },
    async listen() {
      /* noop */
    },
  };

  it('принимает deps-free декларацию', () => {
    transport.endpoint(DepsFree);

    expect(received).toEqual(['GET /ping']);
  });

  it('декларация с зависимостями не проходит по типам', () => {
    // @ts-expect-error: неразрешённые deps — сначала endpoint.resolve(...)
    transport.endpoint(WithDeps);

    // Гашение снимает ограничение
    transport.endpoint(WithDeps.resolve([new UserService()]));

    expect(received).toContain('GET /users');
  });
});
