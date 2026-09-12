import { app } from './app.js';
import { CreateUser } from './create-user.endpoint.js';
import { GetUser } from './get-user.endpoint.js';
import { ClaimQuota, QuotaExceeded } from './intercom-operations.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import {
  assembleTest,
  checkTopologies,
  stub,
  unwrap,
  vars,
} from '@nestlingjs/testing';

const alice = { id: '1', name: 'Alice', email: 'a@example.com' };

/** A fake lives next to the interface, so it stops compiling when it drifts */
const inMemoryUsers = (): UsersRepository => ({
  all: async () => [alice],
  byId: async (id) => (id === alice.id ? alice : null),
  byEmail: async () => null,
});

describe('users', () => {
  it('calls an endpoint through the whole pipeline, without a socket', async () => {
    await using testApp = await assembleTest(app, {
      // The same declaration `main.ts` runs, with two substitutions
      overrides: [[UsersRepository$, inMemoryUsers()]],
      config: vars({ API_TOKEN: 'test-token' }),
    });

    expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  });

  it('returns a declared failure with its status and code', async () => {
    await using testApp = await assembleTest(app, {
      overrides: [[UsersRepository$, inMemoryUsers()]],
      config: vars({ API_TOKEN: 'test-token' }),
      // A stub answers for an operation this assembly does not implement;
      // its answer is validated against the operation schema
      stubs: [stub(ClaimQuota, async () => QuotaExceeded({ limit: 5 }))],
    });

    expect(
      await testApp.call(
        CreateUser,
        { name: 'Bob', email: 'b@example.com' },
        { attributes: { authorization: 'Bearer test-token' } },
      ),
    ).toMatchObject({ isSuccess: false, status: 'too_many_requests' });
  });

  it('assembles every deployment topology', async () => {
    // Structural only: no instance is created, so `config` binds the
    // required keys instead of substituting values
    const reports = await checkTopologies(app, ['all', 'users', 'quotas'], {
      config: vars({ API_TOKEN: 'test-token' }),
    });

    expect(reports).toHaveLength(3);
  });
});
