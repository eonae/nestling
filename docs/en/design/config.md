# Configuration: sections, keys, sources

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-08] Kernel/user space; конфиг как token-families` (and the
> final round of open questions),
> `[2026-07-10] Конфиг: keys-capability вместо configs:-владения`,
> `[2026-07-13] Конфиг: secret() и общие ключи`,
> `[2026-07-14] Конфиг: форма секции — рекорд полей`.
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-09-06] Фаза 0 BOOTSTRAP: источники до сборки, синхронный build(), фабрики без I/O`,
> `[2026-09-06] Конфиг: derived, env({ prefix }), описания полей через конвертеры`,
> `[2026-09-06] HTTP-сервер как ресурс: httpServer({ name }), http({ server })`
> (a family section).
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. Section

A configuration section is an object that maps a schema to every field.
The package exports only the description of the keys; the DI token of
the section itself stays private.

```typescript
// orders.config.ts — only the key descriptor leaves the package
export const OrdersConfig = makeConfig('orders', {
  maxItems:    z.coerce.number().default(100),          // ← key ORDERS_MAX_ITEMS
  databaseUrl: secret(from('DATABASE_URL', z.url())),   // exact name + secret
  apiToken:    secret(z.string()),                      // hidden from output
});
export const ordersKeys = OrdersConfig.keys;        // the exportable right to bind

@Component([OrdersConfig])
export class OrdersService {
  constructor(private cfg: Config<typeof OrdersConfig>) {}
}
```

- A section is a record of fields. The list of fields is known at the
  level of the JS object; the leaves are any Standard Schema
  ([schemas.md](./schemas.md)); `from()` and `secret()` are wrappers
  around a leaf. Deriving key names, the documentation registry and
  binding sources all work with the fields of the record and do not
  look inside the schemas. The fields are validated independently of
  each other.
- The wrappers combine in one order only: `secret()` outside, `from()`
  inside. The reverse order does not compile, and it gives an error at
  the declaration site naming the correct order. The wrappers take no
  part in validation: only the leaf schema checks the value.
- A **derived field** is declared as the third argument of
  `makeConfig`. The argument is a function that gets the `derived`
  constructor and returns a record of derived fields. `derived(deps,
  fn)` names the dependencies by the field names of the first record,
  and `fn` gets their values in order.

  ```typescript
  export const PgConfig = makeConfig('pg', {
    host:     z.string().default('localhost'),
    port:     z.coerce.number().int().default(5432),
    user:     z.string(),
    password: secret(z.string()),
  }, (derived) => ({
    url: derived(['host', 'port', 'user', 'password'],
      (host, port, user, password) =>
        `postgresql://${user}:${password}@${host}:${port}/app`),
  }));
  ```

  The value is computed when the section is validated on ASSEMBLE, and
  again on a reload if at least one dependency changed. The field is
  secret if at least one dependency is secret. The field has no key,
  and it is not part of `.keys`. An error from `fn` at assembly is a
  configuration error naming the section, the field and the list of
  dependencies.

  Three rules rest on types, not on checks at the moment of
  declaration. The name of a dependency comes from the names of the
  first record, so a typo does not compile. The types of the `fn`
  arguments are inferred from the schemas of the dependencies, so a
  false annotation does not compile either. There is nothing to depend
  on among other derived fields: the first record has none. The cost
  of the shape is named directly: a section stopped being one record,
  the schemas are declared as the first argument, the derived fields
  as the second.
- The name of a key is built from the prefix of the section and the
  name of the field: `maxItems` gives `ORDERS_MAX_ITEMS`. `from('KEY',
  schema)` sets the exact name. A section does not name the source of a
  value: it reads the key and does not know where the value came from.
- `makeConfig.family(prefix, record)` declares a **family section**:
  one section per instance of the package. The name of the instance
  enters the prefix: `'default'` gives the keys of the package as they
  are (`HTTP_PORT`), `'admin'` gives them with an addition
  (`HTTP_ADMIN_PORT`). The name is converted to `SCREAMING_SNAKE_CASE`
  by the same rule as a field name. A repeated call with the same name
  gives back the same DI token, and `.keys` is its own for every
  instance: a binding addresses the keys of one instance. Such a
  section is needed where there are several instances with different
  values — two HTTP servers cannot listen on the same port
  ([transports.md §4.2](./transports.md)).

  ```typescript
  const HttpServerConfig = makeConfig.family('http', {
    port: z.coerce.number().int().default(3000),
    host: z.string().default('0.0.0.0'),
  });

  HttpServerConfig('default').keys;   // HTTP_PORT, HTTP_HOST
  HttpServerConfig('admin').keys;     // HTTP_ADMIN_PORT, HTTP_ADMIN_HOST
  ```
- A section is a special case of a DI token family
  ([container.md](./container.md)): a graph node is created when
  someone injects the section. There is no need to register it in a
  module.

## 2. Two rights: injection and binding

The privacy of a section is not checked at `build()`: an injection
from outside is impossible to write.

- The DI token of the section grants the right to inject it. It is not
  exported from the package, so the section cannot be requested from
  outside: no import, no DI token.
- `.keys` grants the right to bind. It is an exportable branded
  descriptor of the set of keys; it cannot be injected, so exporting it
  is safe.

There is no notion of a "section owner" and no `configs:` field on a
module. A supporting ESLint rule reminds you to export `.keys`, not the
result of `makeConfig`.

The shape of the DI token: `makeConfig` returns **the family member
itself**, a `ConfigSection` with `.keys` attached. Injecting the
section and mentioning the member are the same edge of the graph,
because it is the same value. The DI token is an object, so it can
carry `.keys` by itself, with no wrapper class. `.keys` is an instance
of `ConfigKeys<Prefix>`: it has neither an `id` nor a constructor, so
it does not type-check in `deps`.

## 3. Sources and binding at the root

A source is not a provider, it is a `ConfigSource { get; init?;
close?; watch? }` object. One private reader in the kernel reads every
source. It initializes the sources on phase 0 BOOTSTRAP and puts the
values into a snapshot; the sections are computed from the snapshot on
ASSEMBLE, synchronously ([composition.md §1](./composition.md)).
`process.env` is the default source, with the lowest priority; it is
not mentioned in the list of bindings. A source reads its own
coordinates (`path`, `addr`) from `process.env` in `init()`; this is
its only contact with the environment.

The snapshot of phase 0 contains every declared key. A key that no
section names — a member of the `Config(key)` family under an unbound
glob — is read on first access and remembered in the snapshot: the
composition of such members is known only inside `build()`, and the
source's `get()` is synchronous and does no I/O.

A failure of `init()` stops the start with an error naming the source;
retries are declared by the source itself (`vault({ retries: 3 })`).
The reader lives for the duration of `run()`: `close()` of the sources
is called as an explicit step of SHUTDOWN, after the container is
destroyed, and a structural check closes them right after the report.

```typescript
// env only → write nothing about configuration in the root
await makeApp({ features: [OrdersFeature], transports: [http()] }).assemble().run();

// other sources appear → a flat list, order = priority
await makeApp({
  config: [
    [vault(), [ordersKeys]],            // section descriptors
    [file('config.yaml'), ['*_URL']],   // and key globs
  ],
  /* ... */
}).assemble().run();
```

A binding addresses keys (`.keys` descriptors and globs), not DI
tokens. The assembly creates every section injected in the selected
features on ASSEMBLE, and validates them there too. An invalid
configuration stops the start (fail-fast).

A transport declares its own section and gives out one descriptor:
`httpServerKeys(name?)` at `@nestlingjs/transport.http`,
`natsConfigKeys` at `@nestlingjs/transport.nats`. Both are the same
right to bind a source as `.keys` on an application section; the
transport keeps the DI token of the section private, so only the
transport itself can inject it.

`env({ prefix })` is an explicit env source with a prefix: it reads
`<prefix><KEY>` and gives the value under `KEY`. The binding
`[[env({ prefix: 'SERVICE_1_' }), ['*']]]` gets a higher priority than
the implicit `process.env`, so `SERVICE_1_HTTP_PORT` overrides
`HTTP_PORT`, while exact keys like `DATABASE_URL` stay shared. So one
`.env` file serves several services; the sections and `.keys` stay
relative.

The kernel module responsible for configuration is always registered:
there is no field for it in `makeApp`. So an application that needs
nothing beyond `process.env` writes nothing about configuration in the
root.

A glob that matched no declared key gives a warning at start, not an
error: the warning catches a typo like `'*_UR'`, while a glob can also
be aimed at the unbound keys of families. The warnings go to the
kernel logger `Logger$('nestling:config')` at the `warn` level. The
reader is created before the logger and cannot depend on it: the
implementation of the logger reads the configuration section. So
warnings accumulate before `build()`; right after it, the assembly
connects the logger to the reader and hands over what accumulated, and
after that the entries go straight through. In a test, `spyLogger()`
intercepts them by substituting `RootLogger$`
([testing.md](./testing.md)).

## 4. Reloadable

```typescript
export const Runtime = makeConfig.reloadable('runtime', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  rps:      z.coerce.number().default(100),
});

// (a) read-latest — read on every use, no subscription needed
@Component([Runtime])
class Logger {
  constructor(private cfg: Config<typeof Runtime>) {}
  debug(m: string) { if (gte(this.cfg.logLevel, 'debug')) this.write(m); }
}

// (b) react — rebuild the resource on change
@Component([Runtime])
class RateLimiter {
  #bucket = new TokenBucket(100);
  constructor(private cfg: Config<typeof Runtime>) {}
  @OnStart() start(signal: AbortSignal) {
    this.#bucket.refill(this.cfg.rps);
    this.cfg.onChange(signal, (next) => this.#bucket.refill(next.rps)); // unsubscribes by signal
  }
}

// the root: a reloadable source is what turns reload on
await makeApp({ config: [[reloadableFile('runtime.yaml'), [Runtime]]], /* ... */ }).assemble().run();
```

A source with observation (`watch`) tells the reader about a new
value, and the reader updates the reloadable sections: the instance of
the section stays the same, the fields update in place. Two
differences from the start:

- at the start, an invalid value stops the application; on a reload,
  an invalid value is dropped, the last valid one stays, and a warning
  is issued;
- whether a change takes effect depends on the consumer. Reading a
  field on every use and `onChange` see the new value; a value copied
  in the constructor does not update. So reloadable is opt-in.

## 5. Secrets

`secret(leaf)` marks a field as secret; the configuration registry
knows the secret keys. For the consumer, the value stays ordinary: the
type is not branded.

The framework hides secrets in every output it produces itself. There
are three such surfaces:

- `ConfigValidationError`. The issue messages of a secret field are
  replaced with `'<redacted>'`, both in the text of the error and in
  the `failures[].issues` object. The key name, the field name and the
  number of failures stay. The exception: if the value was never set
  (`undefined`), there is nothing to hide, and the message shows in
  full — "the key is not set" is the main debugging scenario for a
  secret.
- The projection of a section. `toJSON()` and
  `nodejs.util.inspect.custom` return a copy with `'***'` in place of
  the secret fields, so `console.log(cfg)` and `JSON.stringify(cfg)`
  are safe. Both members are non-enumerable, the shape of the object
  does not change, and reading a field returns the real value. A
  section with no secret fields does not get these members.
- The `describeConfig()` snapshot. A key carries a `secret` flag;
  there are no values in the snapshot.

**The boundary of the guarantee.** `{ ...cfg }`, `Object.values(cfg)`,
reading a field and passing it to your own logger all return the real
value. The framework is responsible only for what it prints itself.

## 6. Shared keys

Several sections may read one key (`DATABASE_URL`). A key is a shared
read-only resource: the right to read does not mean ownership. A
second section declares reading with no knowledge of the first; there
is no "the key is already taken" error.

- Every section validates the raw value with its own schema
  independently: two sections may see a key differently (`z.string()`
  and `z.coerce.number()`). Any failed validation stops the start.
- The only assembly conflict is a mismatched `reloadable`: one section
  declared the key reloadable, another did not. This is an assembly
  error: every reader of the key must agree on whether the value can
  change on the fly. The error names the key, both sections, both
  fields and both fixes; its text does not depend on the order the
  sections were created in.
- The check covers one assembly and only the created sections. A
  declaration that did not make it into the selected topology creates
  no conflict; the state of one assembly does not affect the next one
  in the same process.
- The secrecy of a shared key is decided over every declared section,
  not only the created ones: if at least one section declared
  `secret()`, the key is hidden everywhere. The asymmetry with the
  previous point is deliberate: hiding too much is safe, failing the
  assembly too often is not.
- `describeConfig()` shows every reader of a key. The index by keys,
  `keys: [{ key, secret, readers: [{ section, field, exact, reloadable,
  secret }] }]`, is built from the declared sections, so it also
  includes readers outside the selected topology.

## 7. Infrastructure on demand and unbound keys

`GrpcClient(server)` is a family member that transitively depends on
`Config(addressKey(server))`. Whoever injects the client gets the
address from the environment with no extra code; eager assembly
creates everything at `build()`. Unbound patterns export their globs
the same way sections export `.keys` (`'*_GRPC_ADDRESS'`). A parameter
known only at runtime (an address from the database) cannot be
expressed by a family: it needs a factory outside the eager graph.

## 8. Introspection and documentation

The registry of configuration properties is the source of generated
documentation: keys, schemas, default values, feature ownership
(derived from the graph), the readers of shared keys, secret marks. It
has neither values nor network calls.

`describeConfig()` returns two projections of the same data: the list
by sections (`sections`) answers "what does this section read", the
index by keys (`keys`) answers "who reads this key". The container's
graph `explain()` reads the same registry index.

`describeConfig({ converters })` translates the leaves into JSON
Schema with the same `SchemaDocConverter` as OpenAPI
([schemas.md §2](./schemas.md)). The description of a key carries the
schema itself and the outcome of the conversion: the schema is
declared by annotation, the schema is obtained from a converter, or
there is no converter for the vendor. The description, the default and
the enumeration are read from the schema through the `description`,
`default` and `enum` fields; there are no separate snapshot fields for
them. The dispatcher is called with the `input` direction: the table
describes what a person writes into the environment. A table of
variables for deployment documentation is built from the snapshot.
With no `converters`, the snapshot stays the same — it has no JSON
Schema fields.

The derived fields of a section stand in the snapshot as a separate
list: the field name, the list of dependencies and the secrecy mark.
They are not part of the list of keys and not part of the
key-centric index, because they have no key and no source can be
bound to them.
