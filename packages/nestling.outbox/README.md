# @nestlingjs/outbox

Transactional emit: the event is written to the database by the same
transaction as the business change, and leaves through the bus after the
commit. The application opens and closes the transaction; the package
neither creates it, nor commits it, nor rolls it back.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/operations.md`](../../docs/en/design/operations.md),
> section "Transactional emit".
> Guide: [chapter 16. Not losing an event on a process
> crash](../../docs/en/guide/16-durable-events.md).

## Install

```bash
npm install @nestlingjs/outbox
```

The package does not choose the storage: the `OutboxStore` adapter comes
from outside. For PostgreSQL it is given by `@nestlingjs/drizzle.pg/outbox`,
for tests there is `InMemoryOutboxStore`, for other databases the
application writes the adapter.

## Minimal example

```typescript
// The plugin is built in the composition root: the transaction
// variable, the DI token of the storage and the list of operations that
// travel through the outbox.
export const appOutbox = outbox({
  transaction: Tx,
  store: OutboxStore$,
  operations: [UserCreated],
});

export const app = makeApp({
  features: [UsersFeature],
  plugins: [persistence, appOutbox],
  transports: [http()],
  policies: [appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })],
});

// In the handler the emitter arrives by the DI token outboxed(UserCreated):
// the user row and the outbox row are committed together. The section of
// the record names the call site: emit(user, { partitionKey: user.id }).
```

## Exports

- **Connection** — `outbox`, `OutboxOptions`, `OutboxPlugin`, `outboxed`,
  `OutboxEmitter`, `OutboxEmitMeta`, `outboxConfigKeys`,
  `OutboxConfigValues`, `StagingTransaction`,
  `OutboxTransactionMissingError`.
- **Storage** — `OutboxStore`, `InMemoryOutboxStore`, `OutboxRecord`,
  `OutboxRecordSnapshot`, `ClaimedRecord`, `OutboxClaimOptions`,
  `OutboxSettlement`.
- **Relay** — `OutboxRelay`, `OutboxRelay$`, `OutboxRelayOptions`,
  `OutboxDrainReport`.
- **Lifecycle facts** — `OutboxPublished`, `OutboxStuck`,
  `OutboxPublishedFact`, `OutboxStuckFact`.

`emit` through the outbox finishes on the fact of the database write, not
on the fact of delivery: the relay does the publishing after the commit.

## Package boundaries

The package does not open the transaction, does not create the table and
does not guarantee an order between partitions. The order inside one
partition is kept.

The ready `OutboxStore` adapter for PostgreSQL is given by
[`@nestlingjs/drizzle.pg/outbox`](../nestling.drizzle.pg/): it writes by
the transaction of the caller and brings both the record table and its
DDL.

The delivery comes out at-least-once: the relay may crash between the
publish and the mark, and then the subscriber gets the event a second
time. The other half of the guarantee is given by
[`@nestlingjs/inbox`](../nestling.inbox/) — the layer that marks a message
processed by the transaction of the subscriber and does not let a repeat
reach the handler.
