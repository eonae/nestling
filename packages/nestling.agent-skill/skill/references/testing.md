# Testing

`assembleTest(app, options)` takes the same declaration that `main.ts`
runs, walks it through BOOTSTRAP, ASSEMBLE, INIT and WIRE and stops there:
the dispatch table exists, no socket is open, no signal handler is
installed and nothing is printed. Names live in the README of
[`@nestlingjs/testing`](https://www.npmjs.com/package/@nestlingjs/testing).

The runner must enable the `testing` resolve condition, or the import fails
with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Jest takes it as a field, `node --test`
as the flag `--conditions=testing`; both are in `references/setup.md`.

```
// jest.config.js
testEnvironmentOptions: {
  customExportConditions: ['testing', 'node', 'node-addons'],
}
```

## An application test

<!-- snippet: assemble-test.ts -->
```typescript
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
```

- `await using` disposes the assembly at the end of the test; without it
  resources stay open between tests.
- `testApp.call(Endpoint, payload, options)` runs the whole pipeline for
  that endpoint — units, validation, handler — without a network. The third
  argument carries what a transport would have brought: `attributes` for
  headers, `input` for transport specifics.
- `unwrap(result)` returns the value of a success and throws on a failure,
  which is what a test wants when the failure is not the subject.
- A failure is asserted as data: `{ isSuccess: false, status: 'not_found',
  value: { code: 'not_found:user' } }`.

The built-in runner needs no adapter. The same test, with `node:test` and
`node:assert/strict`:

<!-- snippet: node-test.ts -->
```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { app } from './app.js';
import { GetUser } from './get-user.endpoint.js';

import { assembleTest, unwrap, vars } from '@nestlingjs/testing';

/**
 * The same assembly under the runner built into Node. Nothing about the
 * framework changes: only the names of the test function and of the
 * assertion, and `--conditions=testing` on the command line instead of a
 * field in a config.
 */
test('calls an endpoint through the whole pipeline, without a socket', async () => {
  await using testApp = await assembleTest(app, {
    config: vars({ API_TOKEN: 'test-token' }),
  });

  assert.deepEqual(unwrap(await testApp.call(GetUser, { id: '1' })), {
    id: '1',
    name: 'Alice',
    email: 'a@example.com',
  });
});
```

Run it with `node --import tsx --test --conditions=testing
"src/**/*.test.ts"`: the loader is there because Node strips types without
compiling them, and a decorator is syntax it cannot parse.

## Substitutions

| Option | Replaces |
|---|---|
| `overrides: [[Token, value]]` | a provider; anything only it needed is pruned from the graph |
| `stubs: [stub(Operation, fn)]` | the owner of an operation this assembly does not implement |
| `config: vars({ … })` | the config binding of the whole declaration, so `process.env` is not read |
| `contextValue(Var, value)` | a context variable in the test root |
| `args: 'users'` | the selection of features, as `assemble` would receive it |

The answer of a stub is validated against the schema of the operation, so a
stub cannot promise something the real owner could not return.
`testApp.pruned` lists the providers that dropped out after an override —
a useful assertion that a fake really did replace a connection.

## Topologies

`checkTopologies(app, ['all', { features: 'users', includeDeps: true }])`
assembles every deployment variant structurally and reports the features,
the endpoints and the operations of each. It opens nothing. Run it once per
application: it is what turns "we also deploy it split" into a test.

## A handler on its own

A handler class is an ordinary class. When the pipeline and the container
are not the subject, construct it and call `handle`.

<!-- snippet: handler-unit.ts -->
```typescript
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
```

For a pipeline unit there is `testUnit(Unit, options)`, which builds the
context around a single unit. Reach for the application test first: it
costs milliseconds and it checks the wiring too.
