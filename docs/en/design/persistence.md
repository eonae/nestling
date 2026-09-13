# The database, the request transaction and satellite storages

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-09-07] Транзакционный outbox: точка врезки, предпосылка транзакции и результат замера границы`,
> `[2026-09-11] Соединение с базой: сателлит drizzle.pg`,
> `[2026-09-12] Транзакционный приём: отметка в базе, слой подписчика, досрочный успех pre-шага`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

The kernel does not pull in a database driver. The connection, the
request transaction and the `OutboxStore` and `InboxStore` adapters
live in the satellite
[`@nestlingjs/drizzle.pg`](../../../packages/nestling.drizzle.pg/): the
adapter and the transaction must be on the same connection, so the
package that carries the transaction layer carries the driver too.
`drizzle-orm` and `pg` are peer dependencies.

The dialect stands in the name of the package, because the dialect
stands in the code: the package opens a transaction with a command on
a connection handed out by the `pg` pool, and issuing a session is
different for every driver. The name follows the rule of the
transports (`transport.http`, `transport.nats`), where the second part
names the implementation.

## 1. The connection is declared as a value

```typescript
export const db = drizzlePg({ schema });
export const analytics = drizzlePg({ name: 'analytics', schema: reports });

export const app = makeApp({
  features: [UsersFeature],
  plugins: [db, analytics],
  transports: [http()],
});
```

The call creates the DI token of the connection, the context variable
of the transaction, the constructor of the layer, the precondition
policy and the configuration key descriptor. All five carry the schema
type of this connection, so referring to a table of another schema is
a compilation error.

Several connections mean several calls. There is no global family
`Db$('analytics')`: a family member carries one value type for the
whole family, and the schema type would be lost. Two calls with the
same name stop the declaration: the name sets the configuration keys,
the identity of the DI token, and the context field that carries the
session, all three.

## 2. The configuration section — a family by connection name

The fields of the section: the address of the database, the size of
the pool, the connection timeout, the idle timeout, the ceiling on
query time and a TLS flag. The default connection reads
`DATABASE_URL`, a named one reads `DATABASE_ANALYTICS_URL`; the kernel
sets the rule for inserting the name ([config.md](./config.md)).

Only the key descriptor goes outward: the DI token of the section
stays private, the same as for the transports and for the outbox. The
address is marked secret, and the derived field with the host inherits
the secrecy — the connection log writes the host, not the address with
the password.

## 3. The pool — a resource with a probe

The pool opens on phase INIT and closes on SHUTDOWN: there is no I/O
on the build phase. Acquisition checks the pool with a first query,
so an unreachable database stops the start with a message naming the
connection and the configuration key with the address.

The resource declares a health check, and the container turns it into
a probe contribution ([composition.md](./composition.md)). The name of
the check equals the identity of the DI token, so in `/readyz` the
connections show up as `database` and `database:analytics`.

The value of the DI token carries two members: a drizzle instance on
the pool, for queries outside a transaction, and issuing a session
with an open transaction.

## 4. The request transaction — a context variable

The `db.transaction(cb)` shape does not fit: the value lives only
inside the callback, while the repository and the emitter read it from
the context of the request. The transaction is declared as a variable,
and a pipeline layer puts it there:

```typescript
export const transactional = compose(authed, db.transaction());
```

Inside the layer there are four parts. A bridge class takes the
connection from the container and opens the transaction with a
`BEGIN` command on a connection from the pool; a variable writer puts
in a drizzle instance bound to this transaction; `.ok` commits;
`.catch` rolls back, and `.finally` returns the connection to the pool
on any outcome, including a broken connection to the client and the
application stopping.

The bridge puts the session into the context, not the value of the
variable: `.ok`, `.catch` and `.finally` read the session, and the
connection from the container issues it. The keys are derived from the
name of the instance deterministically: `tx` and `txSession` for the
default connection, `analyticsTx` and `analyticsTxSession` for a named
one. So two connections do not contend for a context field, and the
compiler checks a key conflict at the point of composition.

The isolation level is set by an argument of the layer constructor and
goes into the opening command. The ceiling on query time is set for
the duration of the transaction.

## 5. The value of the variable — a drizzle instance

```typescript
@Component([db.connection, Ctx(db.tx)])
export class DbUsersRepository {
  async list(limit: number): Promise<User[]> {
    return this.connection.db.select().from(users).limit(limit);
  }

  async insert(data: NewUser): Promise<User> {
    const [row] = await this.tx.get().insert(users).values(data).returning();

    return row;
  }
}
```

A reading method takes the connection from the pool, a mutating one
takes the request transaction. The repository has no wrapper with
`commit` and `rollback` methods: the decision to commit belongs to the
layer.

The `db.requiresTransaction(filter?, label?)` policy requires every
endpoint under the filter to declare the transaction variable. A
violation stops the build on phase BUILD — before phase INIT and
before the socket opens.

## 6. The storage adapter of the outbox

The adapter lives at the subpath `@nestlingjs/drizzle.pg/outbox`, and
`@nestlingjs/outbox` is declared as an optional peer dependency:

```typescript
export const outboxStore = pgOutboxStore(db);

export const appOutbox = outbox({
  transaction: db.tx,
  store: outboxStore.token,
  operations: [UserCreated],
});
```

The write runs in the caller's transaction, so the row of the event
and the row of the business change are committed together. A value of
the wrong shape gives an error with both fixes: declare the
transaction layer of this connection, or pass the outbox plugin the
variable of the same connection. Issuing a batch and marking outcomes
run on the pool: the relay lives outside a request and has no
transaction ([operations.md](./operations.md), §2.6).

The table of records is given as a drizzle declaration and a DDL
string. The application includes the declaration in its own
drizzle-kit schema, and the migration is generated together with the
rest; the DDL string is for those who run migrations by hand. A
separate increasing column sets the order of creation: the identifier
serves as the idempotency key, and two moments of creation within one
millisecond are indistinguishable.

Issuing a batch is one query that skips locked rows: two relay
replicas reading one table will not get the same record. A record with
a partition is not issued until the previous record of the same
partition is marked published or stuck. Marking an outcome is
idempotent: an outcome applies only to a record taken into work.

## 7. The storage adapter of inbox marks

The adapter lives at the subpath `@nestlingjs/drizzle.pg/inbox`, and
`@nestlingjs/inbox` is a second optional peer next to the outbox:

```typescript
export const inboxStore = pgInboxStore(db);

export const appInbox = inbox({ transaction: db.tx, store: inboxStore.token });
```

The mark is put by the caller's transaction, so it and the writes of
the handler are committed together. A value of the wrong shape gives
an error with both fixes — the same ones as for the outbox adapter.

The table is given as a drizzle declaration and a DDL string, like the
table of records. The primary key is composite: the consumer and the
idempotency key. An index on the moment the mark was set is needed by
the cleanup pass.

The primary key resolves a concurrent retry, not the application: the
insert runs with `ON CONFLICT DO NOTHING RETURNING`, and the second
transaction gets zero rows, meaning a retry. A bare insert does not
do: a uniqueness violation in PostgreSQL aborts the whole transaction,
and the layer would not be able to finish the endpoint with success.

The cleanup pass runs on the pool and deletes a batch of marks older
than the retention period: the cleanup task lives outside a request
and has no transaction ([operations.md](./operations.md), §2.6).

## 8. Boundaries

V1 supports no other dialects: every next driver is its own
implementation of issuing a session. Migrations run outside the
process of the application. The package gives no query builder and no
repository of its own — queries are written in drizzle. There is no
two-phase commit: consistency across databases rests on events and the
outbox.

The transaction layer does not apply to the `stream` and `events`
output shapes: the `.ok` step runs at the start of the response phase,
so the commit would run before the handler finished reading the
cursor ([streaming.md](./streaming.md)).
