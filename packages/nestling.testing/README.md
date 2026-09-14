# @nestlingjs/testing

A test composition root. `buildTest(app, options)` builds the same
`makeApp` declaration that `main.ts` starts, and takes the application
through the phases `0 BOOTSTRAP`, `1 BUILD`, `2 INIT`, `3 WIRE`:
`dispatch` is created, the sockets are not open, no signal handlers are
set, and nothing is printed to stdout. The run is silent: the logger
level is `silent` until a test sets its own through `config:` or
substitutes `[RootLogger$, spy.logger]`. `testApp.run()` continues
through `4 START` and `5 RUN` — the socket opens, and
`testApp.baseUrl(name?)` returns its address.

> 🚧 Active development, the API may change. The package introduces no
> runner, no matchers and no snapshot mechanics: the project's runner
> provides them.
> Design: [`docs/en/design/testing.md`](../../docs/en/design/testing.md).
> Guide: [chapter 8. Make sure it works without starting a server](../../docs/en/guide/08-testing.md),
> [chapter 22. Count requests and calls](../../docs/en/guide/22-metrics.md).

## Install

```bash
npm install --save-dev @nestlingjs/testing
```

The test runner must turn on the `testing` resolution condition. The
test surfaces of the packages are declared as subpaths under this
condition, so without it the import fails to resolve with
`ERR_PACKAGE_PATH_NOT_EXPORTED`: the boundary between the test code and
the production code is structural, not a matter of convention.

```javascript
// vitest.config.js
export default {
  resolve: {
    conditions: ['testing', 'node', 'node-addons', 'import', 'default'],
  },
};
```

Node turns on the condition with the `--conditions=testing` flag.

## Minimal example

```typescript
import { app } from './app'; // the same makeApp declaration that main.ts uses

import { bind } from '@nestlingjs/app';
import { buildTest, stub, unwrap, vars } from '@nestlingjs/testing';

await using testApp = await buildTest(app, {
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // a stub for an operation that this build does not implement
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: [bind(vars({ USERS_PAGE_SIZE: '10' }))],
});

const user = unwrap(await testApp.call(GetUser, { id: '1' }));

expect(user).toEqual({ id: '1', name: 'Alice' });
```

## Exports

- **Build** — `buildTest`, `TestApp`, `TestBuildOptions`,
  `TestCallOptions`, `EmitDelivery`, `UnwrapFailedError`, `unwrap`.
- **Substitutions** — `TestOverride`, `TestStub`, `stub`, `OperationStub`,
  `RequestStubImpl`, `EmitStubImpl`, `StubOutput`, `familyOverride`,
  `contextValue`, `vars`, `ObjectSource`.
- **Logger and metrics** — `spyLogger`, `SpyLogger`, `LogEntry`,
  `TestMetrics`, `metricsFor`, `GroupMetrics`.
- **Topologies and bundles** — `checkTopologies`, `TopologyReport`,
  `testBundle`, `TestBundleOptions`.
- **Re-export of [`@nestlingjs/app`](../nestling.app/)** — the core
  names, so that a test imports one package.

`vars(record)` is the package's own `ConfigSource` implementation, not a
wrapper over the core: an object instead of `process.env`, with
`set`/`assign` for reloadable sections. The binding replaces the
declaration's bindings entirely — the declaration has none — so a test
is isolated from both `process.env` and any defaults.

The `transports` list in the options is not accepted: the composition,
transports included, comes from the `makeApp` declaration. Without
`testApp.run()` no sockets open; after it, `testApp.baseUrl(name?)`
returns a server's address — without a name if one server is declared,
by name if several are.

## Package boundaries

The package builds the application and gives access to it. It does
not start transports, does not bring up a database and does not replace
the test runner.
