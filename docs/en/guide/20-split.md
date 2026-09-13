# 20. Spread the features across processes

> Guide to the current API; verified against `76ea1866`.
> Target description: [design/composition.md](../design/composition.md) "L4",
> [design/operations.md](../design/operations.md) §3 and §4.4,
> [design/transports.md](../design/transports.md) §7. Why: entries
> [ideas.md](../../decisions/ideas.md)
> `NATS: шина приложения, а не сосед; durable в контракте; propagate двумя каналами`,
> `Модель композиции: фича, плагин, операция` and
> `[2026-09-12] Разбор обзоров d/10 и d/13`, point 2.

The `users` and `notifications` features work in one process and talk
through operations. The mailing is slow, it retries and it scales apart
from taking registrations, so there is a wish to deploy it as a separate
service. Rewriting the calls to `notifications.check-address` and the
subscription to `users.registered` is not wanted: let the same features
work in two processes, with a broker carrying the messages between
them.

The opposite direction gives the local run. The same declaration with
`assemble('all')` brings up every feature in one process, and the
in-process bus delivers the operations between them: the call to
`notifications.check-address` does not go out to the broker. A broker and several
processes are needed by a staging environment, not by a developer: the
application starts locally with one command even when its features are
spread across services on staging.

## Declare the bus and assign it a role

```typescript
// src/app.ts
export function declareApp(options: DeclareOptions = {}): App {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [metricsPlugin(exporter)],
    // The application's bus is an ordinary transport. `intercom:`
    // assigns it the role of carrying operations between processes:
    // a call to an operation whose owner is not selected in this
    // assembly goes out through this transport
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
  });
}

/** The application: the same value for `main.ts`, the tests and checking topologies */
export const app = declareApp();
```

There is one declaration for every process of the deployment: only the
`app.assemble(select)` argument changes between them. The `declareApp`
function is needed by the test: it passes the transport a connection to
the broker's double, and the metrics server an ephemeral port. Metrics
and the `/metrics` endpoint are covered in [chapter
22](./22-metrics.md).

`nats({ name })` declares a transport the same way `http()` does. The
transport reads the broker's address from its own configuration
section: the `NATS_SERVERS` key, `nats://127.0.0.1:4222` by default.
`intercom: 'events'` assigns this transport the role of carrying
operations. While the role is not assigned, the in-process bus
delivers the operations between features. After the assignment, the
broker takes its place: an application has one bus. A declared bus
with no assigned role stops the assembly, and only transports that
carry operations can take the intercom role: `http()` in `intercom:`
does not compile. With no carrier role, a call to an operation whose
owner is not selected stops the assembly, as in chapter
[19](./19-select.md).

The process's role is set by the feature selection that `main.ts`
reads from `APP_FEATURES` before the assembly, as in chapter
[19](./19-select.md).

## Leave the feature's code as is

```typescript
// src/features/users/registration.service.ts
@Component([CheckAddress.caller, UserRegistered.emitter])
export class RegistrationService {
  constructor(
    private readonly addresses: Port<typeof CheckAddress>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  /** Registers a user: returns `false` if the address is rejected */
  async register(email: string): Promise<boolean> {
    const checked = await this.addresses.call({ email });

    if (checked.isFail) {
      // The owner's failure arrives as a `Fail` of the same
      // `AddressRejected` definition, both from the neighbouring
      // process and from this one
      return false;
    }

    await this.registered.emit({ id: randomUUID(), email });

    return true;
  }
}
```

This class is no different from the one that worked in one process. It
depends on the caller and the emitter, not on the services of the
neighbouring feature. The assembly decides where the call goes.

At the `'users'` selection, there is no owner of `notifications.check-address` in the
process. The assembly binds `CheckAddress.caller` to a remote caller: the
call goes out to the broker as a request waiting for a response, and
the declared `AddressRejected` failure comes back as the same `Fail` as a
call inside the process would give. The owner's replicas form a queue
group, and each message reaches one of them. At the `'all'` selection
both features work in one process, the request runs directly, and the
event still goes out through the broker: its subscribers may be in
other processes.

## Event durability and context across the process boundary

```typescript
// src/operations.ts
export const UserRegistered = makeEvent({
  name: 'users.registered',
  durable: true,
  input: UserRegisteredInput,
});
```

`durable: true` means the delivery survives a restart of the
subscriber. The NATS transport sets up a JetStream stream under such a
subject: the publisher waits for the acknowledgment of the write to
the stream, and the subscriber reads from the stream and acknowledges
the processing. A subscriber that was not running at the moment of the
publish gets the event after it starts. Only `command` and `event`
accept the field: for a `request` the caller waits for the response,
and `durable: true` does not compile for it.

```typescript
// src/features/notifications/welcome-email.endpoint.ts
@Handler([Mailer$])
class WelcomeEmailHandler {
  constructor(private readonly mailer: Mailer) {}

  async handle(payload: UserRegisteredInput) {
    await this.mailer.send(payload.email, welcome(payload));
  }
}

export const WelcomeEmail = implement(UserRegistered, {
  // The subscriber's name is the subscription's address: inside one
  // process it tells subscriptions to one event apart, and at a broker
  // it becomes the name of the queue group and of the durable consumer
  subscriber: 'welcome-email',
  pipeline: base,
  handler: WelcomeEmailHandler,
});
```

The subscriber's name from chapter [15](./15-events.md) gets a second
job here: at a broker it becomes the name of the durable consumer.
Durability is declared in the operation, not in the root, because both
sides must know about it: the publisher waits for the write's
acknowledgment, and the subscriber reads from the stream.

```typescript
// src/context.ts
export const TenantId = contextVar<string>()('tenantId', { propagate: true });
```

The tenant comes from the external client and is needed in both
processes, but it is in no `input` schema. `propagate: true` turns on
carrying the variable across the port's boundary: the caller takes the
value from the current request's context and puts it into the
`Nl-Ctx` message header. Only a variable with this mark is carried;
the rest of the context does not cross the boundary.

```typescript
// src/features/users/register-user.endpoint.ts
@Handler([RegistrationService])
class RegisterUserHandler {
  constructor(private readonly registration: RegistrationService) {}

  async handle(payload: RegisterUserInput) {
    await this.registration.register(payload.email);
  }
}

export const RegisterUserImpl = implement(RegisterUser, {
  // The base layer returns the trace and the tenant into the context:
  // both arrived in the message envelope, and the
  // `notifications.check-address` caller will pass them on
  pipeline: base,
  handler: RegisterUserHandler,
});
```

On the receiving side the value lies in the message's attributes. The
`TenantId.propagated()` unit carries it into the request's
asynchronous context. It is part of the example's base layer, which
stands in the pipeline of every implementation: both `notifications.check-address` and
`users.registered` arrive from another process.

```typescript
// src/base.ts
export const base: Pipeline<EmptyInput, BaseContext> = makePipeline()
  .pre(withTracing())
  .pre(TenantId.propagated());
```

```typescript
// src/features/notifications/suppressions.ts (fragment)
@Component([Ctx(TenantId), Logger$.auto])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  constructor(
    private readonly tenant: CtxReader<string>,
    private readonly logger: Logger,
  ) {}

  reasonFor(email: string): string | undefined {
    this.logger.info('address checked');

    // Every tenant has its own list: the tenant's name arrived in the
    // envelope of the call
    return this.#blocked.get(`${this.tenant.get()}:${email}`);
  }
}
```

The service reads the tenant with the `Ctx(TenantId)` reader, the way
the repository read `requestId` in chapter [9](./09-logging.md). The
reader is declared in the provider's dependencies. The value crossed
two hops: the external client put it into the header, the `users`
process read it and passed it on when calling `notifications.check-address`, and the
`notifications` process read it again.

## The trace across process boundaries

The base layer puts more into the context than the tenant alone.
`withTracing()` from [chapter 9](./09-logging.md) comes first in it, and
it is the one that makes the records of both processes line up:

```text
INFO  RegistrationService register        traceId=feabb90b363acc5bff69c317824a65ae
INFO  Suppressions        address checked traceId=feabb90b363acc5bff69c317824a65ae
```

The first record is written by the `users` process, the second by the
`notifications` process. The value is the same, so searching by it finds the
record from any process together with the rest.

The trace is carried by the same mechanism as the tenant: the kernel
declares the `Trace` variable with `propagate: true`, so the
`notifications.check-address` caller puts it into the message envelope. Only the
receiving side differs: `withTracing()`, not `Trace.propagated()`,
returns the trace into the context there. The same unit continues the
trace both from the bus and from the HTTP `traceparent` header, so the
implementation of an operation and an HTTP endpoint are built from the
same layer.

`traceId` is shared by the two processes, while `spanId` is its own for
each: the span of the caller goes into the `parentSpanId` of the
callee. From this pair the trace assembles into a tree of calls.

That the trace is declared on every route is checked by the assembly
policy:

```typescript
policies: [everyEndpoint().hasVar(Trace, 'trace')],
```

## Start and check two processes

```bash
docker run --rm -p 4222:4222 nats:2 -js
```

The `-js` flag turns on JetStream. Without it the stream under
`users.registered` is not created, and the assembly stops.

```bash
APP_FEATURES=notifications yarn start:dev
APP_FEATURES=users yarn start:dev
```

Start the request's owner first. The broker has no waiting queue for a
request with a response: a call to `notifications.check-address` with no owner
present fails with a delivery failure. The broker's address, if
needed, is set by `NATS_SERVERS=nats://127.0.0.1:4222`.

An external client puts the registration command onto the bus. The
tenant is carried by the context header:

```bash
nats pub users.register '{"email":"alice@example.com"}' -H 'Nl-Ctx:{"tenantId":"acme"}'
```

The same root with `APP_FEATURES=all` brings up both features as one
process. Not a single feature file changes for this.

The `NESTLING_PORTS_DISPATCH=always-remote` dispatch policy sends
every call to an operation as a message, even when the owner works in
this same process. On the in-process bus this means an asynchronous
barrier, a copy of the payload, and a check of the response against
the `output` schema. This way calls go through a path close to the
network one, before a broker even appears. A test for both policies is
written next to the rest of the application's tests.

The test brings up both processes in one jest process on top of the
`NatsDouble` broker double, and no network is needed:

```typescript
// src/split.spec.ts (fragment)
  it('два процесса общаются операциями через брокер', async () => {
    const broker = new NatsDouble();
    const topology = await run(broker, 'notifications', 'users');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { email: 'alice@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    // The call to `notifications.check-address` went out to the broker: there is no
    // owner in the `users` process
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining([
        'users.register',
        'notifications.check-address',
        'users.registered',
      ]),
    );

    expect(tenantOf(broker, 'notifications.check-address')).toBe('acme');
    expect(tenantOf(broker, 'users.registered')).toBe('acme');
    // …
  });
```

`run` creates one application per feature selection: `declareApp` with
a connection to the double, then `assemble(select)` for each role.
`broker.published` keeps every sent message with its headers: the test
checks the subjects and the tenant in `Nl-Ctx` against it, and finds
the `nestling_users_registered` stream through
`broker.jetstreamManager()`. The second test of the same file brings
up the `'all'` selection and checks that `notifications.check-address` does not go
out to the broker. The third reads the logger records of both
processes and matches their `traceId`. The fourth assembles the `users`
process with no owner of `notifications.check-address` and makes sure the assembly
goes through.

```bash
yarn test
```

The operation has become the boundary between processes, and changing
it can now break the neighbouring service: [21. Do not break the
neighbours when an operation changes](./21-compatibility.md).
