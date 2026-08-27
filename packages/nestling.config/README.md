# @nestling/config

Configuration for Nestling built on **token families**: a config section is a
record of fields with Standard Schema leaves, injected like any other
dependency and materialized as an ordinary graph node the moment someone
injects it. There is no registration — no `providers:`, no `imports:`, no
`configs:` key on a module.

Dependencies: `@nestling/container`, `@nestling/streams`, `@common/misc`.
No schema validator is declared — a section leaf is any
[Standard Schema v1](https://standardschema.dev) value.

> 🚧 Active development, API may change. Design:
> [`docs/design/config.md`](../../docs/design/config.md).
> Guide: [`docs/guides/config.md`](../../docs/guides/config.md).

## Declaring a section

```typescript
import { from, makeConfig, secret } from '@nestling/config';

export const OrdersConfig = makeConfig('orders', {
  maxItems: z.coerce.number().default(100),           // ORDERS_MAX_ITEMS
  databaseUrl: secret(from('DATABASE_URL', z.url())), // exact key, redacted
  apiToken: secret(z.string()),                       // ORDERS_API_TOKEN
});

export const ordersKeys = OrdersConfig.keys;
```

Key names are derived from the prefix deterministically: a separator goes in
at a `lower|digit → upper` boundary and at `upper → upper followed by lower`
(`maxItems` → `ORDERS_MAX_ITEMS`, `httpURL` → `ORDERS_HTTP_URL`). `from(key,
schema)` drops the prefix entirely — that is how a key shared by several
sections is declared.

A section never names a **source**: it is provenance-blind. Where a value
comes from is configured in the composition root only.

## Two capabilities, one right each

| Capability | Value | What it allows |
|---|---|---|
| inject | the token returned by `makeConfig` | reading the section |
| bind | `Section.keys` | pointing a source at those keys |

Privacy is impossible-by-construction, not a runtime check: a package exports
`.keys` and keeps the token to itself, so a foreign inject cannot even be
written. `.keys` is not an `InjectionToken` — putting it in `deps` is a
compile error. There is no ownership check on `build()` and no notion of a
section owner in the model.

## Kernel / user space

Public: `makeConfig`, `from`, `secret`, `load`, `Config`, `ConfigKeys`,
`keysGlob`, `describeConfig`, `objectSource`, `configKernel`,
`ConfigValidationError`, `ConfigSharedKeyError`.

Deliberately **not** exported: the reader (`ConfigReader`) and its token, and
the `ConfigSection` family. Those are the kernel side of the boundary, and the
boundary is held by ES module visibility.

## Sources and binding

A source is a plain object, not a provider:

```typescript
interface ConfigSource {
  get(key: string): unknown;
  name?: string;
  init?(): void | Promise<void>;
  watch?(notify: () => void): void;
  close?(): void | Promise<void>;
}
```

One private reader consults them. Bindings are a flat list where **order is
priority**; `process.env` is an implicit floor that is neither declared nor
declarable:

```typescript
configKernel([
  [vault(), [ordersKeys]],
  [file('config.yaml'), ['*_URL']],
]);
```

A target is a `.keys` handle, a glob (`'*_URL'`, `'*'`) or an array of them.
A source whose target does not cover a key is not consulted for it at all.
The reader is an ordinary graph node with an async factory, so `init()` of
every source finishes before any section is projected — that is topology, not
a separate phase; `@OnDestroy` closes the sources on shutdown.

`assemble({ config })` passes the list to this kernel module, which
`@nestling/app` registers **always** — so an application that is happy with
env writes nothing about config in its root.

## Primordial read: `load(section)`

```typescript
const RootConfig = makeConfig('app', { features: z.string().default('all') });

const cfg = load(RootConfig);       // synchronous, process.env only
```

`load` is the single pre-assembly read: the feature selection is needed
before the container exists, so phase 0 has no reader and no bound sources.
Validation is the same as for a projection from the graph — independent per
field, all failures in one `ConfigValidationError`, fail-fast.

## Fail-fast and reloadable

Fields are validated independently through `validateSync`; all failures of a
section arrive as one `ConfigValidationError` naming the section, every failed
key with its issues, and the sources consulted. Validation happens on
`build()` — an invalid config kills startup before any transport listens.

`makeConfig.reloadable(prefix, record)` makes reading a field return the latest
valid value without a subscription; the instance stays stable and
`onChange(signal, cb)` (built on `Topic`) unsubscribes on the signal. The
asymmetry is deliberate: invalid **at startup** kills the process, invalid **on
reload** keeps the last known good snapshot and warns. A reloadable section
bound to no watching source warns at startup — a capability mismatch is not a
contract violation.

## Secrets

`secret(leaf)` marks a field secret. The wrapper takes a schema or a `from()`
result, and the nesting order is the only one: `secret()` outside, `from()`
inside — secrecy is a property of the **field**, `from()` only names its
**key**. The reverse order is rejected by types and, if forced past them,
throws at declaration time naming the fix. Nothing changes for the consumer:
the field type stays `string`, there is no branded `Secret<T>`, and the wrapper
takes no part in validation.

What changes is what the framework prints — three surfaces:

- **`ConfigValidationError`** replaces the issue messages of a secret field
  with `<redacted>` **both in the text and in the object**
  (`failures[].issues`): a validator is free to embed the value in its own
  message, and `failures` is a public field. The key name, the field name and
  the failure count always stay. One exception: if the value was never set
  (`undefined`) there is nothing to redact, so the message is shown in full —
  "key not set" is the main debugging scenario for a secret;
- **the section projection** carries non-enumerable `toJSON()` and
  `nodejs.util.inspect.custom` returning a copy with `'***'` in place of every
  secret field, so `console.log(cfg)` and `JSON.stringify(cfg)` are safe.
  Reading a field still returns the real value — printing is redacted, the
  value is not. A section with no secret fields gets neither member;
- **`describeConfig()`** flags the key as `secret`; the snapshot has never
  carried values.

Key secrecy is a **union over declared readers**: if any section marked the key
`secret()`, it is secret everywhere, including in a section that did not mark
it. The guarantee covers framework output only — `{ ...cfg }`,
`Object.values(cfg)` and your own string interpolation return the real value.
That is a documented property of v1, not a defect: closing it would require the
branded `Secret<T>` that was rejected.

## Shared keys

Any number of sections may read the same key — the right to read a key is not
ownership of it, and a second reader is declared without the first one knowing.
Each section validates the **raw** value with its own schema, so two sections
may legitimately see one key differently (`z.string()` and
`z.coerce.number()`); any failure is fail-fast on `build()`.

The single build conflict is a **disagreeing `reloadable` flag**:
`ConfigSharedKeyError` names the key, both sections, both fields and both
fixes. The check lives on the reader, so its scope is one build and only the
sections actually materialized by the graph: a declaration outside the selected
topology creates no conflict, and one build's state never leaks into the next
one in the same process.

## Introspection

`describeConfig()` returns a snapshot of the registry in two projections of the
same data: `sections` (what each section reads — its keys with field name,
exact-name flag and effective `secret` flag, plus `reloadable` and whether the
graph consumed it), `keys` (who reads each key — the key, its effective secrecy
and every declared reader; `readers.length > 1` means the key is shared), and
`globs`. No values, no network — it is usable for generating documentation at
artifact build time, which is exactly why secrecy and readers are counted over
**declared** sections.

`Config(key)` is a family of single raw keys for on-demand infrastructure: a
parameterized client provider can depend transitively on
`Config(addressKey(server))`, and the eager builder materializes exactly the
keys mentioned in `deps`. The value is **not** validated — validation is a
property of a section.
