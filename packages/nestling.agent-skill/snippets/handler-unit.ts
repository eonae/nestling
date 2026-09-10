import { UserNotFound } from './errors.js';
import { GetUserHandler } from './get-user.endpoint.js';
import type { UsersRepository } from './users.repository.js';

const empty: UsersRepository = {
  all: async () => [],
  byId: async () => null,
  byEmail: async () => null,
};

describe('GetUserHandler', () => {
  it('is a plain class: no container and no pipeline needed', async () => {
    const result = await new GetUserHandler(empty).handle({ id: '404' });

    expect(UserNotFound.is(result)).toBe(true);
  });
});
