# Storage and delivery

How an application reaches a database and how an event leaves the process
without being lost. Names live in the READMEs of
[`@nestlingjs/drizzle.pg`](https://www.npmjs.com/package/@nestlingjs/drizzle.pg),
[`@nestlingjs/outbox`](https://www.npmjs.com/package/@nestlingjs/outbox) and
[`@nestlingjs/inbox`](https://www.npmjs.com/package/@nestlingjs/inbox).

## The connection is a resource

Anything that opens a socket is a `@Resource` with `static acquire` and
`release`: the build stays synchronous, and the connection is opened on the
INIT phase in graph order. `references/container.md` shows the shape.

For PostgreSQL that resource is already written. `makeDrizzlePg({ schema })`
returns a plugin carrying four things at once: the DI token of the
connection, the context variable of the request transaction, a pipeline
layer and a precondition policy.

```text
plugins: [db]                    // db = makeDrizzlePg({ schema })
transactional = compose(authed, db.transaction())
policies: [db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })]
```

`db.connection` is the token to read by, `Ctx(db.tx)` is the drizzle
instance bound to the transaction of this request. A repository reads
through the pool and writes through the transaction, and the layer runs
`BEGIN` before the handler and `COMMIT` after it. `drizzle-orm` and `pg`
are peer dependencies: the application picks the driver version, and the
schema is rolled out by drizzle-kit outside the process.

The section of the default connection reads `DATABASE_URL` and
`DATABASE_POOL_MAX`; an instance named `analytics` reads
`DATABASE_ANALYTICS_URL`. The address is a secret, so printouts and error
texts show a mask.

The transaction layer does not apply to a streaming answer: the `.ok` step
runs when the response phase starts, so for `stream` and `events` the
commit would happen before the handler finished reading the cursor.

## Not losing an event

A process that commits the data and dies before publishing loses the
event. `@nestlingjs/outbox` removes that window: the record of the event
goes into the same transaction as the data, and the send happens after the
commit.

```text
outbox = makeOutbox({ transaction: db.tx, store: OutboxStore$,
                      operations: [UserRegistered] })
plugins: [db, makePgOutboxStore(db), outbox]
policies: [outbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })]
```

The emitter arrives by the DI token `outboxed(UserRegistered)` instead of
`UserRegistered.emitter`, and `emit` resolves on the fact of the database
write, not on the fact of delivery: the relay publishes after the commit.
`makePgOutboxStore()` is the storage for PostgreSQL, `InMemoryOutboxStore`
the one for tests. The package does not open the transaction, does not
create the table and keeps the order inside one partition only.

## Not handling an event twice

The other half of the guarantee is `@nestlingjs/inbox`: the mark
"processed" is committed by the same transaction as the change, so a
repeated delivery does not reach the handler.

```text
inbox = makeInbox({ transaction: db.tx, store: InboxStore$ })
pipeline: compose(db.transaction(), inbox.layer)   // on the subscriber
policies: [inbox.requiresInbox({ transport: BusTransport$ }, 'inbox')]
```

The intake layer is composed **inside** the transaction layer: the mark and
the records of the handler are committed together. The storage is
`makePgInboxStore()` for PostgreSQL and `InMemoryInboxStore` for tests. A
subscriber without the layer fails the BUILD phase, before a socket is
open.

Both packages take the storage from outside, so a database other than
PostgreSQL needs an adapter of the application and nothing else.
