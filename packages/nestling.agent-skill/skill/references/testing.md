# Testing

`buildTest(app, options)` takes the same declaration that `main.ts`
runs, walks it through BOOTSTRAP, BUILD, INIT and WIRE and stops there:
the dispatch table exists, no socket is open, no signal handler is
installed and nothing is printed. Names live in the README of
[`@nestlingjs/testing`](https://www.npmjs.com/package/@nestlingjs/testing).

The runner must enable the `testing` resolve condition, or the import fails
with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Vitest and jest take it as a field,
`node --test` as the flag `--conditions=testing`; all three are in
`references/setup.md`.

```
// vitest.config.js
resolve: {
  conditions: ['testing', 'node', 'node-addons', 'import', 'default'],
}
```

## An application test

<!-- snippet: build-test.ts -->
```typescript
import { app } from './app.js';
import { CreateUser } from './create-user.endpoint.js';
import { GetUser } from './get-user.endpoint.js';
import { ClaimQuota, QuotaExceeded } from './intercom-operations.js';
import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import { bind } from '@nestlingjs/app';
import {
  buildTest,
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
    await using testApp = await buildTest(app, {
      // The same declaration `main.ts` runs, with two substitutions
      overrides: [[UsersRepository$, inMemoryUsers()]],
      config: [bind(vars({ API_TOKEN: 'test-token' }))],
    });

    expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  });

  it('returns a declared failure with its status and code', async () => {
    await using testApp = await buildTest(app, {
      overrides: [[UsersRepository$, inMemoryUsers()]],
      config: [bind(vars({ API_TOKEN: 'test-token' }))],
      // A stub answers for an operation this build does not implement;
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

  it('builds every deployment topology', async () => {
    // Structural only: no instance is created, so `config` binds the
    // required keys instead of substituting values
    const reports = await checkTopologies(
      app,
      [{ features: 'all' }, { features: 'users' }, { features: 'quotas' }],
      { config: [bind(vars({ API_TOKEN: 'test-token' }))] },
    );

    expect(reports).toHaveLength(3);
  });
});
```

- `await using` disposes the build at the end of the test; without it
  resources stay open between tests.
- `testApp.call(Endpoint, payload, options)` runs the whole pipeline for
  that endpoint — steps, validation, handler — without a network. The third
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

import { bind } from '@nestlingjs/app';
import { buildTest, unwrap, vars } from '@nestlingjs/testing';

/**
 * The same build under the runner built into Node. Nothing about the
 * framework changes: only the names of the test function and of the
 * assertion, and `--conditions=testing` on the command line instead of a
 * field in a config.
 */
test('calls an endpoint through the whole pipeline, without a socket', async () => {
  await using testApp = await buildTest(app, {
    config: [bind(vars({ API_TOKEN: 'test-token' }))],
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
| `stubs: [stub(Operation, fn)]` | the owner of an operation this build does not implement |
| `config: vars({ … })` | the config binding of the whole declaration, so `process.env` is not read |
| `contextValue(Var, value)` | a context variable in the test root |
| `args: 'users'` | the selection of features, as `build` would receive it |

The answer of a stub is validated against the schema of the operation, so a
stub cannot promise something the real owner could not return.
`testApp.pruned` lists the providers that dropped out after an override —
a useful assertion that a fake really did replace a connection.

## Topologies

`checkTopologies(app, ['all', { features: 'users', includeDeps: true }])`
builds every deployment variant structurally and reports the features,
the endpoints and the operations of each. It opens nothing. Run it once per
application: it is what turns "we also deploy it split" into a test.

## A handler on its own

A handler class is an ordinary class. When the pipeline and the container
are not the subject, construct it and call `handle`.

<!-- snippet: handler-step.ts -->
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

For one feature or one plugin on its own there is
`testBundle(bundle, options)`. It builds a mini-application around that
bundle, and every dependency a neighbour would have provided must be
stubbed explicitly. Reach for the application test first: it costs
milliseconds and it checks the wiring too.
