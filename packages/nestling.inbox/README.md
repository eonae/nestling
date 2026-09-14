# @nestlingjs/inbox

Transactional receipt: the "processed" mark is committed by the same
transaction as the business change, and a repeated delivery does not
reach the handler. The application opens and closes the transaction; the
package neither creates it, nor commits it, nor rolls it back.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/operations.md`](../../docs/en/design/operations.md),
> section "Transactional receipt".
> Guide: [chapter 16. Not losing an event on a process
> crash](../../docs/en/guide/16-durable-events.md).

## Install

```bash
npm install @nestlingjs/inbox zod
```

`zod` installs next to it: the package writes the schemas of its own
declarations in it, and one copy of the validator serves the package and the
application.

The package does not choose the storage: the `InboxStore` adapter comes
from outside. For PostgreSQL it is given by `@nestlingjs/drizzle.pg/inbox`,
for tests there is `InMemoryInboxStore`, for other databases the
application writes the adapter.

The package is the other half of the delivery guarantee. The first half
is given by [`@nestlingjs/outbox`](../nestling.outbox/): it does not lose
an event, and this one does not let it be processed twice.

## Minimal example

```typescript
// The plugin is built next to the connection: its `layer` field is
// needed by the subscriber declaration.
export const inbox = makeInbox({ transaction: db.tx, store: inboxStore.token });

// The intake layer is composed inside the transaction layer: the mark
// and the records of the handler are committed together.
export const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: compose(db.transaction(), inbox.layer),
  handler: WelcomeEmailHandler,
});

export const app = makeApp({
  features: [UsersFeature],
  plugins: [db, inboxStore, inbox],
  transports: [http()],
  // The precondition is checked on the BUILD phase: a subscriber
  // without the layer fails the build before the socket opens
  policies: [inbox.requiresInbox({ transport: BusTransport$ }, 'inbox')],
});
```

## Exports

- **Connection** — `makeInbox`, `InboxOptions`, `InboxPlugin`, `InboxLayer`,
  `inboxConfigKeys`, `InboxConfigValues`, `InboxClaimStep`,
  `readIdempotencyKey`, `InboxKeyMissingError`.
- **Storage** — `InboxStore`, `InMemoryInboxStore`, `InboxMark`,
  `InboxClaim`, `InboxSweepOptions`, `RollbackAwareTransaction`.
- **Mark sweeper** — `InboxSweeper`, `InboxSweeper$`,
  `InboxSweeperOptions`.

The mark is stored by the pair "endpoint pattern and idempotency key".
One event goes to several subscribers with one key, and each
deduplicates it on its own.

The configuration section reads `INBOX_RETENTION_MS`,
`INBOX_SWEEP_INTERVAL_MS`, `INBOX_BATCH_SIZE` and `INBOX_SWEEP`. The
retention period must cover the retry window of the broker: a removed
mark stops recognising a repeat, and the last delivery attempt reaches
the handler a second time. The default is seven days, and it covers with
a margin the deduplication window of the stream that the NATS transport
sets (5 minutes by default).

## Package boundaries

The package does not open the transaction, does not create the table and
does not mint an idempotency key: a message without a key in the
envelope finishes with an error. A minted key would differ between two
deliveries of the same message and would always look new.

The package gives no exactly-once for an effect outside the
transaction. A letter sent by the handler before the commit of the mark
leaves a second time if the process crashes between the send and the
commit. The retry window narrows down to this gap, and this is all that
can be promised without a distributed transaction with a mail service.

The package does not replace the deduplication window of the stream, and
cannot be replaced by it. The broker removes fast repeats of a publish:
a relay that returns to the record inside the window does not place a
second copy into the stream. Repeats of delivery, and a repeat that
arrives past the window, remain: the transport has no application
transaction, so the mark and the business change are committed together
only here. The intake layer is required at every window.

The ready `InboxStore` adapter for PostgreSQL is given by
[`@nestlingjs/drizzle.pg/inbox`](../nestling.drizzle.pg/): it sets the
mark by the transaction of the caller and brings both the mark table and
its DDL.
