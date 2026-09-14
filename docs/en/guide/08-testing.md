# 8. Make sure it works without starting a server

> Guide to the current API; verified against `561d1000`.
> Target description: [design/testing.md](../design/testing.md). Why: entry
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-10] Пакет тестирования (@nestlingjs/testing)`.

Tests must call endpoints through the same pipeline as requests over the
network, but without a socket and without environment variables. A separate
fast unit test of the handler needs neither a container, nor an application,
nor a database.

```typescript
// src/app.ts (fragment)
export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  // …
});
```

The test must build the same application as `main.ts` — its whole
composition. The declaration therefore lives in a separate file, and
`main.ts` and the tests import the same `app` value. The test does not copy
the composition dictionary: `buildTest` accepts the declaration itself.

```typescript
// src/app.spec.ts
import { app } from './app.js';

/** The test config: an object instead of `process.env` */
const testConfig = [
  bind(
    vars({ API_TOKEN: 'test-token', DATABASE_URL: TEST_DATABASE_URL ?? '' }),
  ),
];
```

The test sets only what belongs to the run: overrides, the feature selection
and the config. There is no need to replace transports: the test build
does not run START, so the socket does not open and the port stays free.

The database in this suite is real. The pool opens on the INIT phase, and
the transaction layer and the outbox store write SQL, so replacing them with
a fake would test code other than the one that runs in production. The
application specs are skipped without `TEST_DATABASE_URL`: locally
`yarn db:up` brings up the database, in CI a workflow service does
([chapter 11](./11-database.md)). The handler unit test needs no database
and is never skipped.

## The resolve condition in the test runner

The test runner must enable the `testing` condition. The test surfaces of
the packages — the whole of `@nestlingjs/testing` and the `./testing`
subpaths of `app` and the transports — are declared as conditional exports
under this condition, so without it the import fails to resolve with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

```javascript
// vitest.config.js
export default {
  resolve: {
    conditions: ['testing', 'node', 'node-addons', 'import', 'default'],
  },
};
```

The boundary turns out structural: production code does not import test
substitutes by agreement, but because Node cannot find them. Node enables
the condition with the `--conditions=testing` flag.

## A call through the full pipeline

```typescript
// src/app.spec.ts
it('отдаёт пользователя через полный пайплайн', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
  expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
});
```

`buildTest(app, options)` builds the same declaration and runs the
application through the phases up to `WIRE`: the graph is built, the
policies are checked the same way as at start, the instances are created,
the resources are acquired, the routing table is built. The test build
does not relax them: an application that does not build in production
does not build in the test either. The socket does not open, and no
signal handlers are set. `await using` closes the application at the end of
the test. The variable is named `testApp` so that it does not shadow `app`
from `app.ts`.

`testApp.call(Endpoint, payload)` calls the endpoint by the value of the
declaration and checks the same input as a request over the network — so
`testApp.call` and HTTP give the same result. The request passes through
every layer of the pipeline, the input check by the schema and the failure
check by `errors`. Parsing the path, the query and the body does not
happen: `call` accepts a ready payload. `unwrap` returns the value of a
successful response or throws an error with the category and the code of
the failure.

The response carries `isSuccess`, `status` and `value`. For a failure,
`value` holds the code and the details, and `status` equals the category of
the code:

```typescript
// src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

## Replacing graph nodes

```typescript
// src/testing.ts
export function inMemoryUsersRepo(seed: readonly User[] = []): UsersRepository {
  const rows: User[] = seed.map((user) => ({ ...user }));

  return {
    all: async () => rows,
    byId: async (id) => rows.find((user) => user.id === id) ?? null,
    // …
  };
}
```

The fake implements the `UsersRepository` interface over an array. It lives
next to the interface: the interface changed, and the fake stopped
compiling in the same commit.

```typescript
// src/app.spec.ts
it('не создаёт узлы, которые нужны только подменённому хранилищу', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // The logger and the context reader are needed only by the production
  // store: after the override the container does not create them
  expect(testApp.pruned).toContain('Logger:DbUsersRepository');
  expect(testApp.pruned).toContain('Ctx:requestId');
});
```

`overrides` replaces a graph node by DI token. The pair in it is typed, so a
fake that does not match the type of the DI token does not compile, and an
override of a DI token missing from the graph stops the build. The
override happens before the instances are created, so a subtree that nobody
needs anymore falls out of the graph. Only the production repository
depends on the logger and the `Ctx(RequestId)` reader: after the override
the container does not create them. `testApp.pruned` lists the nodes that
fell out.

The database connection is not on this list: the outbox store shares it
([chapter 16](./16-durable-events.md)). Exactly what is left without its
only consumer falls out — and this is visible as a value, not a guess.

```typescript
// src/app.spec.ts
it('читает размер страницы из конфига', async () => {
  await using testApp = await buildTest(app, {
    config: [
      bind(
        vars({
          API_TOKEN: 'test-token',
          APP_PAGE_SIZE: '1',
          DATABASE_URL: TEST_DATABASE_URL ?? '',
        }),
      ),
    ],
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice, bob])]],
  });

  expect(unwrap(await testApp.call(ListUsers, {}))).toEqual([alice]);
});
```

`vars(record)` gives a config source from an object. The `bind(vars({…}))`
binding in the `config` option is the test run's only source: the
declaration has no bindings at all. `process.env` is neither read nor
changed, so tests are isolated and can run in parallel.

## A unit test of the handler

```typescript
// src/users/endpoints/create-user.endpoint.spec.ts
describe('CreateUserHandler', () => {
  it('создаёт пользователя и отвечает статусом created', async () => {
    const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

    const result = await handler.handle({
      name: 'Carol',
      email: 'carol@example.com',
    });

    expect(result).toMatchObject({
      status: 'created',
      value: { id: '2', name: 'Carol' },
    });
  });
});
```

The handler class, as in chapter 5, is created through `new` with a fake.
Such a test checks the logic of the handler and does not check the
pipeline, the schemas and the `errors` list: that is the job of the test
that calls the endpoint through the full pipeline.

```bash
yarn test
```

The service is built and covered with tests. The next part prepares it for
production, starting with the log of requests: [9. See every request in the
log](./09-logging.md).
