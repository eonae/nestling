# 11. Write to the database in the request transaction

> Guide to the current API; verified against `7e80fcd8`.
> Target description: [design/persistence.md](../design/persistence.md). Why:
> entry [ideas.md](../../decisions/ideas.md)
> `[2026-09-11] Соединение с базой: сателлит drizzle.pg`.

The repository from [chapter 6](./06-repository.md) holds users in memory:
the process restarted, and the data is gone. The service needs a real
database, and along with it a requirement the in-memory store did not
have. A request changes several rows, and it changes them either wholly or
not at all.

Opening a transaction in the handler is not a way out. Then every handler
remembers about commit and rollback, and a forgotten rollback turns up in
production. The one who already wraps the request must open the
transaction — the pipeline — and the handler must get a repository that
already writes into it.

One package carries all of this — `@nestlingjs/drizzle.pg`: the connection
to PostgreSQL, the transaction variable and the layer that opens it.

## The connection is declared as a value

```typescript
// src/persistence.ts
export const db = drizzlePg({ schema });
```

One call creates five things: the DI token of the connection, the context
variable of the transaction, the layer constructor, the prerequisite
policy and the descriptor of the config keys. All five carry the type of
the schema, so a reference to a table of a foreign schema is a compilation
error.

The schema is an ordinary drizzle declaration. The table of outbox records
comes from the package, so its migration is generated together with the
migrations of the application; [chapter 16](./16-durable-events.md) shows
why this table is needed:

```typescript
// src/schema.ts
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
});

export const outbox = outboxTable();

export const schema = { users, outbox };
```

The connection is a plugin, so it stands in `plugins:` of the root, not in
the `providers:` of a feature. The reason is the feature boundary check
from [chapter 14](./14-features.md): it does not let infrastructure depend
on the DI token of a feature, and the background tasks of the package need
the store.

The package declares the config section. By default the connection reads
`DATABASE_URL`, `DATABASE_POOL_MAX` and the rest of the keys without a name
inserted; a second connection would be declared by a second call with a
`name` field and would read `DATABASE_ANALYTICS_URL`. The address is
marked as a secret, so only the host reaches the connection log.

The pool opens on the INIT phase and closes on SHUTDOWN, and the connection
probe reaches `/readyz` under the name `database`. An unreachable database
stops the start with a message that names both the connection and the
config key with the address.

## The transaction is opened by the pipeline

The familiar idiom `db.transaction(async (tx) => { … })` does not fit
here. The transaction in it lives only inside the callback, which means
both the repository and the emitter would have to get it as a parameter —
from the handler, which must not know about transactions. Outside the
callback there is no transaction at all.

So the transaction is a context variable of the request, and a layer of
the pipeline puts it there:

```typescript
// src/persistence.ts
export const transactional = compose(authed, db.transaction());
```

Four steps live inside the layer. The first takes the connection from the
container and sends `BEGIN` on a client issued by the pool. The second
puts a drizzle instance bound to this transaction into the context. `.ok`
commits, `.catch` rolls back, and `.finally` returns the client to the
pool — on any outcome, including a dropped connection to the client and an
application stop.

The first step is a class, because it puts a session, not the value of a
variable, into the context: `.ok`, `.catch` and `.finally` all read it, and
the connection that issues it comes from the container. Earlier the
application wrote such a bridge by hand (recipe ["Extend the kernel with
your own package"](../recipes/extending.md)); now it is declared inside
`drizzlePg` next to the DI token of the connection and stays invisible from
the outside.

The key of the variable is derived from the name of the connection: `tx`
for the default connection, `analyticsTx` for the instance named
`analytics`. So two connections in one request do not fight over a context
field, and a key conflict would be caught by the compiler at the point of
composition.

The isolation level is set by an argument: `db.transaction({ isolation:
'serializable' })` opens the transaction with a command at this level.

## The repository reads the transaction from the context

A reading method takes the connection from the pool, a mutating one takes
the transaction of the request:

```typescript
// src/users/users.repository.ts
@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ? toUser(row) : null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
    // The write goes through the request transaction: a rollback will not save it
    const [row] = await this.tx
      .get()
      .insert(users)
      .values({ id: crypto.randomUUID(), ...data, avatarUrl: null })
      .returning();

    return toUser(row);
  }
}
```

This is the same trick as with `Ctx(RequestId)` from
[chapter 9](./09-logging.md): the value comes from the context of the
request, not as a parameter through the whole call chain. The difference
is in the reading method. `peek()` on `requestId` allows the value to be
absent: the same method can be called from a background task. `get()` on
the transaction does not allow it: a write without a transaction is a
defect, and it must fail rather than pass unnoticed.

The value of the variable is the drizzle instance itself, not a wrapper
with `commit` and `rollback` methods. A wrapper would give the repository
the right to commit, and that is a decision of the layer.

An endpoint that changes data is composed from the transaction layer:

```typescript
// src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: transactional,
  handler: CreateUserHandler,
});
```

`transactional` is composed from `authed`, so the Bearer token check comes
along with it, and the endpoint does not connect it a second time.

## The prerequisite is checked at build

A write without a transaction would fail on the first request in
production — an unacceptable failure mode for a framework that checks its
invariants before start. The connection gives out the policy as a value,
and the root names which endpoints it concerns:

```typescript
// src/app.ts
policies: [
  everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(authed, 'authed'),
  db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
  // …
],
```

The predicate is the same `hasVar` from [chapter 10](./10-auth.md), only
the connection names the variable. An endpoint that changes data and is
not composed from the transaction layer stops the build on the BUILD
phase — before the socket opens and before the first request.

## The schema is rolled out outside the process

drizzle-kit runs the migrations, and the application does not roll them
out: a process that migrates itself at start needs a lock between
replicas.

```bash
yarn db:up       # PostgreSQL in docker
yarn db:generate # a migration from the schema
yarn db:migrate  # roll it out

TEST_DATABASE_URL=postgresql://users:users@localhost:5432/users yarn verify
```

`db:generate` reads `src/schema.ts` and writes a file into `drizzle/`. The
table of outbox records ends up there together with the table of users,
because both stand in the same schema. To an application that runs
migrations by its own means, the package gives out a ready DDL string —
`outboxDdl()`.

## What is configurable

The `database` section sets the address, the pool size, the connection and
idle timeouts, the query time ceiling and the TLS flag. The ceiling is set
for the duration of the transaction: a long handler holds a pool
connection, and the rest of the requests wait for it.

```bash
DATABASE_POOL_MAX=5 yarn start:dev
```

## Check

```typescript
// src/app.spec.ts
it('создаёт пользователя по Bearer-токену из конфига', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });
  await seed(testApp);

  const created = await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  expect(created).toMatchObject({
    isSuccess: true,
    status: 'created',
    value: { name: 'Carol' },
  });
});
```

The test needs a real database: the pool opens on the INIT phase, and the
layer writes SQL. The address comes through the `TEST_DATABASE_URL`
variable, and without it the application specs are skipped — `yarn verify`
stays green on a machine without a database, and CI brings up PostgreSQL
as a service. The variable has its own name, not `DATABASE_URL`: a test
run must not depend on what lies in the environment under the name of the
production key. The `seed(testApp)` seeding takes the connection from the
built graph: this is the same connection the endpoints work with.

A rollback is checked the same way: a request with the wrong Bearer token
gets a failure, the layer rolls back the transaction, and no records of
this request remain in the database.

## What is left out of the picture

The transaction layer does not apply to a streamed response: the `.ok`
step runs at the start of the response phase, so for the `stream` and
`events` output forms the commit would pass before the handler finished
reading the cursor.

There is no such thing as one transaction over two connections: the
package does not do a two-phase commit, and consistency between databases
rests on events and the outbox ([chapter 16](./16-durable-events.md)).
There is still only one dialect — PostgreSQL: issuing a session is
different for every driver.

An export that does not fit in memory, and receiving a file as a form:
[chapter 12](./12-files-and-streams.md).
