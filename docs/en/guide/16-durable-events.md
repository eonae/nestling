# 16. Do not lose an event when the process falls

> Guide to the current API; verified against `02d6b233`.
> Target description: [design/persistence.md](../design/persistence.md). Why:
> entries [ideas.md](../../decisions/ideas.md)
> `[2026-09-07] Транзакционный outbox: точка врезки, предпосылка транзакции и результат замера границы`
> and
> `[2026-09-12] Транзакционный приём: inbox как вторая половина гарантии outbox'а`.

The service creates a user and tells the neighbours about it with an
event ([chapter 15](./15-events.md)). Writing to the database and
sending the event are two different operations, and a window sits
between them: the process crashes after the commit but before the send,
and the event is lost for good. The neighbours never learn about the
user, and there is nothing to recover the loss with — the database
keeps no trace that an event was due.

The fix is old and is called the transactional outbox: the event is
written to the same database by the same transaction as the business
change, and a background job sends it after the commit. Then "user
created" and "event must be sent" either happen together or do not
happen at all.

Everything this needs is already there: the request transaction from
[chapter 11](./11-database.md) is available to the repository and to
the emitter alike. The record store is carried by the same
`@nestlingjs/drizzle.pg` package: the adapter and the transaction must
live on one connection.

## The event in the same transaction

The outbox store is declared on the same connection, and the
`@nestlingjs/outbox` package receives the transaction variable and the
DI token of the store:

```typescript
// src/persistence.ts
export const outboxStore = pgOutboxStore(db);

// src/app.ts
export const appOutbox = outbox({
  transaction: db.tx,
  store: outboxStore.token,
  operations: [UserRegistered],
});
```

The list of operations is explicit: the recipe needs the operation
itself — the input schema to check the payload, and the name to know
the subject. The plugin does not assign the record's partition: the
call site of `emit` names it, and more on that below.

In the handler one line changes: the one that names the dependency:

```typescript
// src/features/users/endpoints/create-user.endpoint.ts
@Handler([UsersRepository$, outboxed(UserRegistered)])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly userRegistered: OutboxEmitter<typeof UserRegistered>,
  ) {}

  async handle(input: CreateUserInput): Output<User, typeof EmailTaken> {
    // …
    const user = await this.users.insert(data);

    // Writing the user and writing the event are one transaction. If
    // the process crashes right after the commit, the event still
    // goes out. The partition is the user's identifier: their events
    // are delivered in order
    await this.userRegistered.emit(
      { id: user.id, name: user.name, email: user.email },
      { partitionKey: user.id },
    );

    return Ok.created(user);
  }
}
```

`outboxed(UserRegistered)` replaces `UserRegistered.emitter`. The value is
`OutboxEmitter<typeof UserRegistered>`: the kernel's emitter whose `meta`
dictionary gains the record's partition. It is assignable to
`Emitter<typeof UserRegistered>`, so a handler that does not need the
partition declares the dependency by the old type. The partition is
the unit of order: the events of one user are delivered in the order
they were created, and there is no order between different users. The
call site names it, because only the call site knows what orders the
record. What `emit` does changes too: it writes one row into the store
with the caller's transaction, and it sends nothing to the bus during
the request.

The kernel's DI token stays in place: `UserRegistered.emitter` still sends
at once. A send from `@OnStart` or from a background job, where there
is no transaction, is written with exactly this emitter. The
transactional `emit` outside a transaction neither stays silent nor
sends directly: it fails with an error that names both fixes.

The same policy that checks the connection checks the precondition: the
outbox plugin gives it out under the same transaction variable
([chapter 11](./11-database.md)). An endpoint that calls the
transactional `emit` and is not composed from the transaction layer
stops the build on the BUILD phase.

## Who sends the record

The relay, the outbox package's background job, works through the
records. It publishes a record to the bus with the idempotency key
equal to the record's identifier, and marks it sent. The key is needed
because the delivery comes out at-least-once: the relay can crash
between the publish and the mark, and then the same record is
published a second time.

The subscriber catches the repeat, which the next section covers. The
adapter issues a batch with one query that skips locked rows, so two
replicas of the relay reading one table never get the same record. A
record with a partition is not issued until the previous record of the
same partition is marked published or stuck.

The relay is declared as a resource, not as a component. The SHUTDOWN
phase raises the signal and releases resources in the reverse
topological order, and nobody waits for a component's background job
to finish. A resource, though, finishes writing the current batch in
`release()`, and the connection closes after it, because the relay
depends on it.

## A repeat does not reach the handler

The idempotency key reaches the subscriber, but deciding what to do
with it is the subscriber's job. Keeping the seen keys in memory does
not work: a `Set` lives only until a restart and is not shared between
replicas. The "processed" mark must live in the same database and
commit with the same transaction as the business change: a mark
without the change loses the event, and a change without the mark
gives a repeat.

This is the second half of the guarantee, and the `@nestlingjs/inbox`
package provides it. Its precondition is the same as the outbox's: the
application opens the transaction, and the store arrives as a DI token.

```typescript
// src/persistence.ts
export const inboxStore = pgInboxStore(db);

export const appInbox = inbox({ transaction: db.tx, store: inboxStore.token });

// The subscriber layer: a transaction with no Bearer token check —
// a message from the bus carries no token
export const subscribed = compose(observability, db.transaction());
```

The subscriber composes the inbox layer **inside** the transaction
layer:

```typescript
// src/features/notifications/welcome-email.endpoint.ts
export const WelcomeEmail = implement(UserRegistered, {
  subscriber: 'welcome-email',
  pipeline: compose(subscribed, appInbox.layer),
  handler: WelcomeEmailHandler,
});
```

The layer does two things. Its first step puts the idempotency key
from the message envelope into the context, and the handler reads it
as the familiar `meta.idempotencyKey`. The second calls the store: the
mark is set by the pair "the endpoint's pattern and the key". For an
event's subscriber the pattern looks like `users.registered@welcome-email`,
so two subscribers of one event deduplicate independently.

If the mark already existed, the step returns `done()`, an early
success. The following steps and the handler are not called, the
response phase starts with a success, and the broker gets the
acknowledgment: there is nothing left to retry. Early success is a
general pipeline channel ([chapter 10](./10-auth.md)), not a
deduplication concept.

The standard `withIdempotencyKey()` takes no part in the layer: it
mints a missing key on its own, and a minted key differs between two
deliveries of the same message and would always look new. A message
with no key in the envelope fails: an event with no key from the
publisher is a defect, and silently processing it twice is worse than
stopping.

The package's background job cleans up marks by a retention period.
The period must cover the broker's window of repeats: a removed mark
stops recognizing a repeat.

## The broker catches a part of the repeats

Repeats come from two sources. The first is the relay: it publishes a
record, gets no acknowledgment, and after a pause publishes it again.
The second is the broker: a message is delivered again if the handler
crashed after a side effect and before the `ack`.

The broker itself narrows the first source. The NATS transport puts
the `Nats-Msg-Id` header with the idempotency key's value on a durable
publish, and the stream the transport creates carries a deduplication
window, 5 minutes by default. A repeat with the same key inside the
window does not enter the stream, and does not reach the subscriber.
This requires nothing from the application: the relay already sets the
key equal to the record's identifier.

```typescript
// The window is set by a factory option; the default covers the relay's retry cycle
nats({ name: 'events', dedupeWindowMs: 600_000 });
```

This does not cancel the inbox layer. Outside the window there remain
delivery repeats — the whole second source — and a repeat publish that
arrives later than the window: a relay that returns to the record an
hour later publishes it again. The transport has no transaction of the
application, so the mark and the business change commit together only
in the layer. The broker's window cuts the number of repeats, and the
inbox gives the guarantee.

## The test does not wait for a timer

The relay's loop is split into two levels: `drain()` makes one pass
over a batch, and `@OnStart` repeats it until the signal. A test
build stops after the WIRE phase and does not run `@OnStart`
([chapter 8](./08-testing.md)), so the test makes the pass itself:

```typescript
// src/app.spec.ts
it('кладёт событие в outbox и доставляет его проходом relay', async () => {
  const spy = spyLogger();
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[RootLogger$, spy.logger]],
  });
  await seed(testApp);

  await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  // Nothing went to the bus during the request: the record landed in
  // the store
  expect(spy.entries).not.toContainEqual(
    expect.objectContaining({ message: 'welcome email sent' }),
  );

  const relay = testApp.get(OutboxRelay$);
  expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });

  // Delivery over the bus is asynchronous: the subscriber works
  // through the topic as a separate task
  await waitFor(
    () => countOf(spy.entries, 'welcome email sent') === 1,
    'письмо подписчика',
  );
});
```

`waitFor` is a small helper from the same spec file: it polls a
condition until it fires or until a timeout. It is needed because
`publish` puts the message into the topic, and the subscriber works
through it as a separate task: checking for its trace right after the
relay's pass is a race.

A pass of the mark sweeper is called the same way, with one method:
`app.get(InboxSweeper$)?.sweepOnce()`.

A rollback is checked the same way: a request with a wrong Bearer token
gets a failure, the layer rolls back the transaction, and the next
`drain()` finds no record at all.

## What is configurable

The `outbox` section sets the poll interval, the batch size, the
backoff, the number of attempts before the "stuck" mark, and the flag
"the relay runs in this process". The last one is needed in a split
deployment ([chapter 20](./20-split.md)): every process creates
records, and one process works through them — two replicas of the
relay would compete for one table.

The `inbox` section sets the mark's retention period, the interval and
the batch size of a pass, and the flag "this process cleans the
table". The last one is needed for the same reason as the relay's: two
replicas of the sweeper would compete for one table.

```bash
OUTBOX_RELAY=false INBOX_SWEEP=false \
  yarn start:dev
```

The delivery delay shows through the `outbox.published` operation: the
difference between `publishedAt` and `createdAt` is the price for the
event surviving a process crash. A record that has run out of attempts
publishes `outbox.stuck`: this is a point for intervention, not for
self-repair. Both operations may have no subscribers: the application
builds and runs without them.

## Checking

Both halves of the guarantee are checked by one test: it sets a
published record back to the `pending` state, the way a relay that
crashed between the publish and the mark would.

```typescript
// src/app.spec.ts
it('повторная публикация записи не вызывает хендлер второй раз', async () => {
  // … creating the user and the first relay pass
  const connection = testApp.get(db.connection);

  // The relay crashed between the publish and the mark: the record
  // waits to be issued again. Its idempotency key stays the same:
  // it is the record's identifier
  await connection.db
    .update(outboxRecords)
    .set({ state: 'pending', publishedAt: null });

  expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });

  // The inbox layer recognized the repeat by the pair "pattern and key"
  await waitFor(
    () => countOf(spy.entries, 'inbox skipped a duplicate') === 1,
    'запись о повторе',
  );

  // The email went out exactly once
  expect(countOf(spy.entries, 'welcome email sent')).toBe(1);
});
```

The record is published a second time, the inbox layer recognizes the
repeat by the pair "pattern and key", and the email goes out exactly
once. The mark sweeper is checked by a separate test: it sets
`INBOX_RETENTION_MS=0` and waits for a pass to empty the table.

## What stays out of scope

The package does no sagas: correlation and process state are a
separate topic.

The inbox gives exactly-once only to what commits with the
transaction. An email sent by the handler before the mark's commit
goes out a second time if the process crashed between the send and the
commit. The window of a repeat narrows down to this gap, and without a
distributed transaction with the mail service, nothing more can be
promised.

How such a package is built inside, and how measuring the kernel's
boundary found four spots later closed by the `kernel-boundary-outbox`
change, is covered by
[the recipe "Extend the kernel with your own package"](../recipes/extending.md)
and the [ideas.md [2026-09-07]](../../decisions/ideas.md) entry.

The event has gone out to the neighbours. The client in the browser
needs a live feed: [chapter 17](./17-live-feed.md).
