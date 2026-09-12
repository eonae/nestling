# @nestlingjs/testing

A test composition root. `assembleTest(app, options)` assembles the same
`makeApp` declaration that `main.ts` starts, takes the application
through the phases `0 BOOTSTRAP`, `1 ASSEMBLE`, `2 INIT`, `3 WIRE` and
stops: `dispatch` is created, the sockets are not open, no signal
handlers are set, and nothing is printed to stdout.

> 🚧 Active development, the API may change. The package introduces no
> runner, no matchers and no snapshot mechanics: jest stays jest.
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
// jest.config.js
export default {
  testEnvironmentOptions: {
    customExportConditions: ['testing', 'node', 'node-addons'],
  },
};
```

Node turns on the condition with the `--conditions=testing` flag.

## Minimal example

```typescript
import { app } from './app'; // the same makeApp declaration that main.ts uses

import { assembleTest, stub, unwrap, vars } from '@nestlingjs/testing';

await using testApp = await assembleTest(app, {
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // a stub for an operation that this assembly does not implement
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: vars({ USERS_PAGE_SIZE: '10' }),
});

const user = unwrap(await testApp.call(GetUser, { id: '1' }));

expect(user).toEqual({ id: '1', name: 'Alice' });
```

## Exports

- **Assembly** — `assembleTest`, `TestApp`, `TestAssemblyOptions`,
  `TestCallOptions`, `EmitDelivery`, `UnwrapFailedError`, `unwrap`.
- **Substitutions** — `TestOverride`, `TestStub`, `stub`, `OperationStub`,
  `RequestStubImpl`, `EmitStubImpl`, `StubOutput`, `familyOverride`,
  `contextValue`, `vars`.
- **Logger and metrics** — `spyLogger`, `SpyLogger`, `LogEntry`,
  `spyMetrics`, `SpyMetrics`, `MetricRecord`.
- **Topologies and units** — `checkTopologies`, `TopologyReport`,
  `testUnit`, `TestUnitOptions`.
- **Re-export of [`@nestlingjs/app`](../nestling.app/)** — the core
  names, so that a test imports one package.

The `transports` list in the options is not accepted: the test assembly
does not run START, so no sockets open and there is no need to
substitute a port.

## Package boundaries

The package assembles the application and gives access to it. It does
not start transports, does not bring up a database and does not replace
the test runner.
