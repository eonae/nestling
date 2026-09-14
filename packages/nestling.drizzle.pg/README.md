# @nestlingjs/drizzle.pg

A PostgreSQL connection, a request transaction context variable and
`OutboxStore`/`InboxStore` adapters over drizzle-orm. The connection is
declared as a value: `makeDrizzlePg({ schema })` gives a plugin with the
connection DI token, the transaction variable, a pipeline layer and a
precondition policy.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/persistence.md`](../../docs/en/design/persistence.md).
> Guide: [chapter 11. Writing to the database by the request
> transaction](../../docs/en/guide/11-database.md).

## Install

```bash
npm install @nestlingjs/drizzle.pg drizzle-orm pg zod
```

`drizzle-orm`, `pg` and `zod` are peer dependencies: the application chooses
the version of the driver and the version of the validator, and there must
be no second copy of either in the process. The storage adapters live in the `./outbox` and `./inbox`
subpaths, and `@nestlingjs/outbox` and `@nestlingjs/inbox` are optional
peer dependencies for them: an application without them installs the
package and knows nothing about the storages.

drizzle-kit rolls out the schema outside the process of the application:
a migration on startup would need a lock between replicas.

The tests of the package that need a working database read its address
from `TEST_DATABASE_URL` and are skipped without it. The database for
them is started next to it, on its own port, and needs no schema: the
tests create the tables themselves.

```bash
yarn db:up
TEST_DATABASE_URL=postgresql://nestling:nestling@localhost:55432/nestling yarn test
```

## Minimal example

```typescript
// The connection is a value: the DI token, the transaction variable, the
// layer and the policy are created by one call and carry the schema type.
export const db = makeDrizzlePg({ schema });

// The transaction layer is composed into the endpoint pipeline. `BEGIN`
// runs before the handler, `COMMIT` after it, the connection always
// returns to the pool.
export const transactional = compose(authed, db.transaction());

export const app = makeApp({
  features: [UsersFeature],
  plugins: [db, makePgOutboxStore(db)],
  transports: [http()],
  policies: [db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })],
});

// In the repository: reading by a connection from the pool, writing by
// the request transaction. `Ctx(db.tx)` gives the drizzle instance bound
// to it.
@Component([db.connection, Ctx(db.tx)])
export class DbUsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}
}
```

## Exports

- **Connection** — `makeDrizzlePg`, `DrizzlePgOptions`, `DrizzlePgPlugin`,
  `PgConnection`, `PgSchema`, `databaseConfigKeys`,
  `DatabaseConfigValues`, `PgConnectionFailedError`,
  `PgDuplicateConnectionError`.
- **Request transaction** — `PgSession`, `PgTx`, `BeginOptions`,
  `IsolationLevel`, `TxLayer`, `TxLayerInput`, `TxBridgeClass`.
- **Subpath `./outbox`** — `makePgOutboxStore`, `PgOutboxStorePlugin`,
  `PgOutboxStoreOptions`, `PgOutboxStore`, `PgOutboxTransactionError`, plus
  everything from the group below.
- **Subpath `./outbox/table`** — `outboxTable`, `OutboxTable`,
  `outboxDdl`, `DEFAULT_OUTBOX_TABLE`. A separate subpath is needed by
  drizzle-kit: it builds the schema as CJS, and only what does not pull
  in the kernel suits it from the package.
- **Subpath `./inbox`** — `makePgInboxStore`, `PgInboxStorePlugin`,
  `PgInboxStoreOptions`, `PgInboxStore`, `PgInboxTransactionError`, plus
  everything from the group below.
- **Subpath `./inbox/table`** — `inboxTable`, `InboxTable`, `inboxDdl`,
  `DEFAULT_INBOX_TABLE`. A separate subpath is needed for the same reason
  as the outbox table.

The configuration section of the default connection reads `DATABASE_URL`,
`DATABASE_POOL_MAX` and the other keys with no name inserted; an instance
named `analytics` reads `DATABASE_ANALYTICS_URL`. The address is marked a
secret: printing the section and the error text show a mask, and the
connection log writes the host.

## Package boundaries

The package does not migrate the schema, does not give its own query
builder and does not open one transaction over two connections:
consistency between databases rests on events and the outbox. Other
dialects are not supported in V1: the session issuance is specific to
each driver.

The transaction layer does not apply to a streaming response: the `.ok`
step runs at the start of the response phase, so for the `stream` and
`events` output shapes the commit would pass before the handler finished
reading the cursor.

A long transaction holds a pool connection. There are as many
connections as `DATABASE_POOL_MAX` sets, so the ceiling on request time is
set by the `DATABASE_STATEMENT_TIMEOUT_MS` key and applies for the
duration of the transaction.
