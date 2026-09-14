# 18. Test a feature without its neighbours

> Guide to the current API; verified against `6717ebad`.
> Target description: [design/testing.md](../design/testing.md) §3 and §4. Why:
> entry [ideas.md](../../decisions/ideas.md)
> `[2026-07-10] Пакет тестирования (@nestlingjs/testing)`.

The `users` feature calls `notifications.check-address` and sends
`users.registered` and `notifications.forget-address`. The mailing team
has not written the implementation yet, and the registration tests are
needed now. And the
other way round: the feature needs checking alone, without its
neighbours, so that the test depends neither on their code nor on the
broker.

The basics from [chapter 8](./08-testing.md) are assumed known:
`buildTest`, `testApp.call`, `unwrap`, `overrides` and `vars`.

## Build one feature without its neighbours

```typescript
// src/isolated.spec.ts (fragment)
const isolated = makeApp({ features: [UsersFeature, NotificationsFeature] });

await using testApp = await buildTest(isolated, { args: 'users' });
```

The build argument in the test is the same as in production: only
the selected features remain in the graph
([chapter 19](./19-select.md)). Such a build stops on the BUILD
phase:

```
Operation 'notifications.check-address' (kind 'request') is injected as '.caller', but no
selected feature implements it and this build has no intercom, so the
call has nowhere to go. Either add the feature that implements it to the
build argument (or close the selection over calls with
'build({ features, includeDeps: true })'), or assign the intercom role
to a bus transport ('transports: [nats({ name: "events" })]' with
'intercom: "events"') when the owner lives in another process.
```

The caller `CheckAddress.caller` in the `users` feature's dependencies
requires an owner of the operation. In a build of one feature there
is no owner, and a stub takes its place.

## Stubs instead of neighbouring operations

```typescript
// src/isolated.spec.ts
  it('регистрирует пользователя через стабы соседних операций', async () => {
    const claimed: { email: string }[] = [];
    const registered: { id: string; email: string }[] = [];

    await using testApp = await buildTest(isolated, {
      args: 'users',
      // There is no owner of `notifications.check-address` and no subscriber of
      // `users.registered` in the build: both sides are replaced
      // by stubs
      stubs: [
        stub(CheckAddress, async (input) => {
          claimed.push(input);

          return { remaining: 1 };
        }),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });
```

`stub(Operation, impl)` returns a pair of the caller's DI token and a
fake: for `request` this is `CheckAddress.caller`, for `command` and
`event` this is `.emitter`. The pair is passed in the `stubs:` field.
The stub's provider takes priority over the production recipe for the
caller, so the owner check does not fire, and the feature builds:
overriding a node that is not in the graph does not stop the build.
A stub of an operation that has an owner among the selected features is
also allowed: it takes priority over the owner.

`impl` gets a payload typed by the operation's `input` schema and
returns a value typed by `output`. A fake that does not fit the
operation does not compile. A stub has no spy of its own: an ordinary
function or `vi.fn()` fits as `impl`. The list of stubbed operations
is available as `testApp.stubbed`: the names in alphabetical order.

A stub cannot part ways with the operation at runtime either. The input
is checked by the `input` shape, a successful response by the `output`
shape. If the `notifications.check-address` stub returns `{ left: 1 }` instead of
`{ remaining }`, the caller gets a failure, not a wrong value:

```
{
  "isSuccess": false,
  "status": "BAD_REQUEST",
  "value": {
    "code": "bad_request",
    "details": [{ "message": "Invalid input: expected number, received undefined", "path": ["remaining"] }]
  }
}
```

A failure from a stub must be included in the operation's `errors:`. A
declared failure passes through as is, the same way it would arrive
from a real owner:

```typescript
// src/isolated.spec.ts (fragment)
      stubs: [
        // The failure is declared in the operation's `errors:`, so
        // the stub gives it back as is, the same way a real owner
        // would over the network
        stub(CheckAddress, async () => AddressRejected({ limit: 100 })),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
```

An undeclared code stops the test with an error naming the operation,
the code and the allowed set, instead of turning into `InternalError`.
An exhausted `deadline` gives `timeout` before `impl` is called, and a
command's `emit` always carries `idempotencyKey`, like a production
port's.

## Calling and checking through a topology matrix

```typescript
// src/isolated.spec.ts (fragment)
    const [{ subscriber, response }] = await testApp.emit(RegisterUser, {
      email: 'alice@example.com',
    });

    expect(subscriber).toBe('users.register');
    expect(response.isSuccess).toBe(true);
    expect(claimed).toEqual([{ email: 'alice@example.com' }]);
    expect(registered).toEqual([
      { id: expect.any(String), email: 'alice@example.com' },
    ]);
```

`testApp.emit(Operation, payload)` delivers a command or an event to
every subscriber in this process through its full pipeline and returns
a list of deliveries: the subscriber's name and the response. An event
may have no subscribers, and then the list is empty. A command requires
a subscriber: without one `emit` fails with an addressing error listing
the available subjects. Calling a `request` operation through `emit` is
not possible, it is a compilation error: it has an owner, not
subscribers.

A stub of the emitter does not get in the way here. A stub replaces
what the feature sends outward, and `emit` carries a message from
outside inward.

A stub makes the test graph smaller than the production one: a stub
hides an operation that nobody implements. So a check of the honest
graph stands next to the stubs:

```typescript
// src/isolated.spec.ts
  it('каждая застабанная операция реализована в одной из топологий', async () => {
    await using testApp = await buildTest(isolated, {
      args: 'users',
      stubs: [
        stub(CheckAddress, async () => ({ remaining: 1 })),
        // An event's subscriber returns nothing: an event has no
        // `output`
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stub(UserRegistered, () => {}),
      ],
    });

    // The matrix checks the graph with no overrides: a stub of an
    // operation that no topology implements becomes visible here
    const topologies = await checkTopologies(app, [
      { features: 'all' },
      { features: 'users' },
      { features: 'notifications' },
    ]);

    const published = new Set(
      topologies.flatMap(({ report }) =>
        report.operations.map(({ name }) => name),
      ),
    );

    expect(testApp.stubbed.filter((name) => !published.has(name))).toEqual([]);
    expect(testApp.stubbed).toEqual(['notifications.check-address', 'users.registered']);
  });
```

`checkTopologies` builds each topology with no overrides and returns
a report with the `operations` field. The test compares
`testApp.stubbed` with the union of the published operations.

## Overriding in an app test: context, graph, topologies

The store reads `requestId` with the `Ctx(RequestId)` reader from
chapter [9](./09-logging.md). The reader is a node of the graph, so it
is overridden with the same `overrides` list. `contextValue(Variable,
value)` gives a reader with a constant value:

```typescript
// src/app.spec.ts
  it('contextValue подставляет значение переменной в тестовом корне', async () => {
    const spy = spyLogger();
    await using testApp = await buildTest(app, {
      ...testConfig,
      overrides: [
        [RootLogger$, spy.logger],
        contextValue(RequestId, 'req-fixed'),
      ],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    expect(spy.entries).toContainEqual({
      level: 'debug',
      message: 'byId 1',
      fields: { scope: 'DbUsersRepository', requestId: 'req-fixed' },
    });
  });
```

The `traced` layer still puts its own `requestId` into the
context, but the service reads the overridden value.
`familyOverride(Family, make)` overrides a whole DI token family in the
same `overrides` list.

```typescript
// src/app.spec.ts
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` is selected alone: there are no providers of the `users`
    // feature in the graph, and plugins are in every build
    await using testApp = await buildTest(app, {
      ...testConfig,
      args: 'ops',
    });

    expect(testApp.get(AuditOutcome)).not.toBeNull();
    expect(testApp.get(SubscriptionRegistry)).not.toBeNull();
    expect(testApp.get(ActivityHub)).toBeNull();
  });

  it('замыкает выбор по вызываемым операциям', async () => {
    await using testApp = await buildTest(app, {
      ...testConfig,
      args: { features: 'users', includeDeps: true },
    });

    expect(testApp.features).toEqual(['users', 'notifications']);
  });
```

`testApp.get(token)` returns an instance from the built graph or
`null` if the node is not in the graph. `testApp.features` lists the
selected features after the closure over the calls.

It is convenient to keep this chapter's tests in one `isolated.spec.ts`
file: building one feature, stubs with a success and with a failure,
`testApp.emit`, and checking `testApp.stubbed` against the matrix. The
`contextValue` tests and the graph composition tests stay in
`app.spec.ts` next to the rest of the application's tests.

```bash
yarn test
yarn test
```

The application in production builds the same way, in parts:
[19. Start only a part of the features](./19-select.md).
