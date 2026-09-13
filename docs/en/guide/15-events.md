# 15. Tell the neighbours what happened

> Guide to the current API; verified against `20e63d95`.
> Target description: [design/operations.md](../design/operations.md), the
> "Three kinds" and "Call profile" sections. Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-07-08] Порты: межфичевое общение через контракты` and
> `[2026-07-31] Порты: бюджет вызова моментом, ключ идемпотентности у команд`.

The mailing feature must learn about every user created, but the response
to the client must not wait for the letter to go out. Tomorrow analytics
will want to know the same thing, and the registration code must not
change. The reverse holds too: a deleted user must be forgotten by the
mailing, such a request has exactly one receiver, and he must tell a
repeated delivery of one message apart from a new request.

```typescript
// src/operations.ts
export const UserRegisteredInput = z.object({
  id: z.string(),
  name: z.string(),
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
The event lies in the same file as the `CheckAddress` request from
[chapter 14](./14-features.md).

```typescript
// src/features/notifications/welcome-email.endpoint.ts
@Handler([Logger$.auto])
class WelcomeEmailHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.info('welcome email sent', {
      userId: payload.id,
      email: payload.email,
    });
  }
}

export const WelcomeEmail = implement(UserRegistered, {
  subscriber: 'welcome-email',
  handler: WelcomeEmailHandler,
});
```

The subscriber is the same `implement` declaration as a request has,
with one difference: the `subscriber` field is required for the
implementation of an event and forbidden for the implementation of a
request or a command. It gives the subscription a name. Inside a
process the endpoint's pattern is built as `users.registered@welcome-email`,
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
// src/features/users/endpoints/create-user.endpoint.ts
@Handler([
  UsersRepository$,
  CheckAddress.caller,
  UserRegistered.emitter,
  ForgetAddress.emitter,
  ActivityHub,
])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: Port<typeof CheckAddress>,
    private readonly registered: Emitter<typeof UserRegistered>,
    private readonly forget: Emitter<typeof ForgetAddress>,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof AddressRejected> {
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

The request to take an address out of the mailings is carried not by an
event but by a command:

```typescript
// src/operations.ts
export const ForgetAddressInput = z.object({ email: z.string() });

export type ForgetAddressInput = z.infer<typeof ForgetAddressInput>;

export const ForgetAddress = makeCommand({
  name: 'notifications.forget-address',
  input: ForgetAddressInput,
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
// src/features/users/endpoints/delete-user.endpoint.ts
    // A command: the caller sets the idempotency key so that a retry
    // after a failure carries the same key. Without a key the port
    // would generate a new one
    await this.forget.emit(
      { email: removed.email },
      { idempotencyKey: removed.id },
    );
```

The idempotency key is the identity of an intent. The deletion of one
user remains one intent even if the process crashed after `delete` and
repeated the `emit`, so the key is taken as its identifier. A command
without an explicit key still leaves with one: the emitter generates it,
and it stays the same for every repeated delivery of one `emit`.

The command's owner reads the key from the context:

```typescript
// src/features/notifications/forget-address.endpoint.ts
@Handler([Suppressions])
class ForgetAddressHandler {
  constructor(private readonly suppressions: Suppressions) {}

  async handle(payload: ForgetAddressInput) {
    this.suppressions.forget(payload.email);
  }
}

export const ForgetAddressImpl = implement(ForgetAddress, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: ForgetAddressHandler,
});
```

```typescript
// src/features/notifications/suppressions.ts
@Component([Logger$.auto, Ctx(IdempotencyKey)])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Takes the address out of the mailings together with the idempotency key */
  forget(email: string): void {
    this.#blocked.set(email, 'user asked to be forgotten');

    this.logger.debug('address forgotten', {
      email,
      intent: this.intent.get(),
    });
  }
}
```

`withIdempotencyKey()` is a ready pre-unit from `@nestlingjs/app`: it
takes the key from the call parameters and declares the
`IdempotencyKey` context variable. The service reads it through
`Ctx(IdempotencyKey)`, the same way the store read `RequestId` in
[chapter 9](./09-logging.md). There is no deduplication by the key here:
the kernel delivers the key to the handler, and what to do with it is up
to the command's owner.

A policy checks that the unit stands in the implementation's pipeline:

```typescript
// src/app.ts
    // The implementation of the command puts the idempotency key into
    // the context: a service deep in the graph reads it through `Ctx`
    everyEndpoint({
      transport: BusTransport$,
      pattern: /^notifications\.forget-address$/,
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
waits to see whether a letter reaches that address. An event fits when
a fact has already happened and the subscribers decide who needs it. A
command fits when there is exactly one receiver and a repeated delivery
needs to be told apart from a new intent.

## What the log shows

Start the service at the `debug` level and create a user:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook NESTLING_LOG_LEVEL=debug \
  yarn start:dev
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
curl -X DELETE localhost:3000/users/3 -H 'authorization: Bearer secret'
```

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository insert carol@example.com requestId=b7600481-…
2026-09-06T12:00:00.001Z INFO  WelcomeEmailHandler welcome email sent userId=3 email=carol@example.com
2026-09-06T12:00:00.002Z INFO  AuditOutcome POST /users created requestId=b7600481-… outcome=completed
2026-09-06T12:00:01.000Z DEBUG Suppressions address forgotten email=carol@example.com intent=3
```

The second line is written by the event's subscriber, the last by the
command's owner: the key that arrived is the identifier of the deleted
user. Both work in their own request context: the values of the caller's
context, including `requestId`, do not reach the implementation.

## Checking

```typescript
// src/app.spec.ts
it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await deleteUser(testApp, alice.id));

  // `emit` finishes on delivery, not on processing
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The caller set the user's id as the key, and the command's owner got it
  const forgotten = spy.entries.find(
    (entry) => entry.message === 'address forgotten',
  );
  expect(forgotten?.fields).toEqual({
    scope: 'Suppressions',
    email: alice.email,
    intent: alice.id,
  });
});
```

The test deletes a user through the full pipeline and finds the record of
the command's owner by its `message`. The pause of one tick is needed
because `emit` finishes on delivery, and the command's handler runs after
it. The record's `intent` field matches the user's identifier: the value
the caller set reached the service deep in the graph with no parameter.

The neighbour in the process is not the only one who wants to know
about the new user: so does the client in the browser.
[17. A live feed for the client](./17-live-feed.md).
