# 15. Tell the neighbours what happened

> Guide to the current API; verified against `app-with-http` (2026-09-13).
> Target description: [design/operations.md](../design/operations.md), the
> "Three kinds" and "Call profile" sections. Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-08] Порты: межфичевое общение через контракты` and
> `[2026-07-31] Порты: бюджет вызова моментом, ключ идемпотентности у команд`.

The quotas feature must learn about every user created, but the response
to the client must not wait for it to process the fact. Tomorrow the
mailing feature will want to know the same thing, and the registration
code must not change. Quotas also keep a log of registrations, and the
log must tell a repeated delivery of one message apart from a new
registration.

```typescript
// examples/app-with-http/src/operations.ts
export const UserRegisteredInput = z.object({
  id: z.string(),
  email: z.string(),
});

export type UserRegisteredInput = z.infer<typeof UserRegisteredInput>;

export const UserRegistered = makeEvent({
  name: 'users.registered',
  input: UserRegisteredInput,
});
```

`makeEvent` declares an operation of the `event` kind: a fact that has
already happened. An event has a name and an `input` schema, and no
`output` or `errors`: a fact has no response. An event may have any
number of subscribers, including zero, and then `emit` finishes at once.
The event lies in the same file as the `ClaimQuota` request from
[chapter 14](./14-features.md).

```typescript
// examples/app-with-http/src/features/quotas/user-registered-in-quotas.endpoint.ts
@Handler([Logger$.auto])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.info('quota bookkeeping', {
      userId: payload.id,
      email: payload.email,
    });
  }
}

export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: UserRegisteredInQuotasHandler,
});
```

The subscriber is the same `implement` declaration as a request has,
with one difference: the `subscriber` field is required for the
implementation of an event and forbidden for the implementation of a
request or a command. It gives the subscription a name. Inside a
process the endpoint's pattern is built as `users.registered@quotas`,
and two subscribers of one event are told apart by their names. The
assembly stops with the same name twice. At a broker the name becomes
the name of the receiver group, so the author assigns it, not the
framework.

The handler of an event returns nothing. An operation without `output`
has the value type `void`, so the handler needs no `return` at the end.

The subscriber is listed in the feature's `endpoints:` next to the
implementation of the request. The list from
[chapter 14](./14-features.md) already contains it.

## Publishing

```typescript
// examples/app-with-http/src/features/users/endpoints/create-user.endpoint.ts
@Handler([
  UsersRepository$,
  ClaimQuota.caller,
  UserRegistered.emitter,
  SignupRecorded.emitter,
  ActivityHub,
])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
    private readonly signup: Emitter<typeof SignupRecorded>,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded> {
    // …
    const user = await this.users.insert({
      name: payload.name,
      email: payload.email,
    });

    // An event: `emit` finishes on delivery, a subscriber's failure
    // does not reach the caller
    await this.registered.emit({ id: user.id, email: user.email });
    // …
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`UserRegistered.emitter` is the DI token of the emitter. The handler
gets an object of type `Emitter<typeof UserRegistered>` with the
`emit(payload, meta?)` method. `emit` returns a `Promise<void>` that
finishes when the message is delivered, not when a subscriber has
processed it. A subscriber's failure or exception does not reach the
caller: it goes into the bus's diagnostic hook.

A new subscriber appears with no changes to `create-user`: one more
`implement(UserRegistered, { subscriber: '…' })` in any feature is
enough.

## A command with an idempotency key

The record in the quotas log is written not by an event but by a
command:

```typescript
// examples/app-with-http/src/operations.ts
export const SignupRecordedInput = z.object({
  userId: z.string(),
  email: z.string(),
});

export type SignupRecordedInput = z.infer<typeof SignupRecordedInput>;

export const SignupRecorded = makeCommand({
  name: 'quotas.record-signup',
  input: SignupRecordedInput,
});
```

`makeCommand` declares an operation of the `command` kind: a message
with no response that has exactly one owner. A command has the
`idempotencyKey` field in `meta`: the type of `meta` is chosen by the
operation kind, and reading this field on a request does not compile.
An event has the field too, but nobody mints a key for it: it travels
only when the publisher has passed it
([chapter 16](./16-durable-events.md)).

```typescript
// examples/app-with-http/src/features/users/endpoints/create-user.endpoint.ts
    // A command: the caller sets the idempotency key so that a retry
    // after a failure carries the same key. Without a key the port
    // would generate a new one
    await this.signup.emit(
      { userId: user.id, email: user.email },
      { idempotencyKey: user.id },
    );
```

The idempotency key is the identity of an intent. The registration of
one user remains one intent even if the process crashed after `insert`
and repeated the `emit`, so the key is taken as `user.id`. A command
without an explicit key still leaves with one: the emitter generates
it, and it stays the same for every repeated delivery of one `emit`.

The command's owner reads the key from the context:

```typescript
// examples/app-with-http/src/features/quotas/signup-recorded.endpoint.ts
@Handler([SignupJournal])
class SignupRecordedHandler {
  constructor(private readonly journal: SignupJournal) {}

  async handle(payload: SignupRecordedInput) {
    this.journal.record(payload.userId);
  }
}

export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: SignupRecordedHandler,
});
```

```typescript
// examples/app-with-http/src/features/quotas/signup.journal.ts
@Component([Logger$.auto, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Records the registration together with the idempotency key */
  record(userId: string): void {
    this.logger.debug('signup recorded', {
      userId,
      intent: this.intent.get(),
    });
  }
}
```

`withIdempotencyKey()` is a ready pre-unit from `@nestlingjs/app`: it
takes the key from the call parameters and declares the
`IdempotencyKey` context variable. The log reads it through
`Ctx(IdempotencyKey)`, the same way the store read `RequestId` in
[chapter 9](./09-logging.md). The example does no deduplication by the
key: the kernel delivers the key to the handler, and what to do with it
is up to the command's owner.

A policy checks that the unit stands in the implementation's pipeline:

```typescript
// examples/app-with-http/src/app.ts
    // The implementation of the signup command puts the idempotency
    // key into the context: a service deep in the graph reads it
    // through `Ctx`
    everyEndpoint({
      transport: BusTransport$,
      pattern: /^quotas\.record-signup$/,
    }).hasVar(IdempotencyKey, 'idempotencyKey'),
```

The policies from [chapter 10](./10-auth.md) picked out the endpoints
of the HTTP transport. Here the filter points at the bus transport
`BusTransport$` and the pattern of the command, and the `hasVar` check
requires the pipeline to declare the variable. Without
`withIdempotencyKey()` the assembly stops.

## The three kinds of operation

| Kind | Constructor | Owners | Response | `idempotencyKey` in `meta` | `durable` |
|---|---|---|---|---|---|
| request | `makeRequest` | exactly one | `Ok` or `Fail` | no | no |
| command | `makeCommand` | exactly one | no | yes | allowed |
| event | `makeEvent` | any number of subscribers | no | no | allowed |

A request fits when you cannot go on without a response: registration
waits to see whether a slot in the quota is claimed. An event fits when
a fact has already happened and the subscribers decide who needs it. A
command fits when there is exactly one receiver and a repeated delivery
needs to be told apart from a new intent.

## What the log shows

Start the service at the `debug` level and create a user:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook NESTLING_LOG_LEVEL=debug \
  yarn workspace @examples/app-with-http start:dev
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 1","email":"user1@example.com"}'
```

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository insert user1@example.com requestId=b7600481-…
2026-09-06T12:00:00.001Z INFO  UserRegisteredInQuotasHandler quota bookkeeping userId=3 email=user1@example.com
2026-09-06T12:00:00.002Z DEBUG SignupJournal signup recorded userId=3 intent=3
2026-09-06T12:00:00.003Z INFO  AuditOutcome POST /users created requestId=b7600481-… outcome=completed
```

The second line is written by the event's subscriber, the third by the
log: the key that arrived is the user's identifier. The subscriber and
the log work in their own request context: the values of the caller's
context, including `requestId`, do not reach the implementation.

## Checking

```typescript
// examples/app-with-http/src/app.spec.ts
it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo()],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await createUser(testApp, 'signed'));

  // `emit` finishes on delivery, not on processing
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The caller set the user's id as the key, and the log got it
  const recorded = spy.entries.find(
    (entry) => entry.message === 'signup recorded',
  );
  expect(recorded?.fields).toEqual({
    scope: 'SignupJournal',
    userId: expect.any(String),
    intent: recorded?.fields.userId,
  });
});
```

The test creates a user through the full pipeline and finds the log
record by its `message`. The pause of one tick is needed because `emit`
finishes on delivery, and the command's handler runs after it. The
record's `intent` field matches `userId`: the value the caller set
reached the service deep in the graph with no parameter.

The neighbour in the process is not the only one who wants to know
about the new user: so does the client in the browser.
[17. A live feed for the client](./17-live-feed.md).
