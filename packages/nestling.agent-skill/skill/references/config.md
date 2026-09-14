# Configuration

Configuration is declared in sections. A section is a value with a prefix
and a schema per field; it is injected as a dependency and validated before
the container is built. Names live in the README of
[`@nestlingjs/app`](https://www.npmjs.com/package/@nestlingjs/app).

## A section

<!-- snippet: app.config.ts -->
```typescript
import { from, makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * A config section: a prefix and a field per value. The variable name is
 * the prefix plus the field name in upper case (`APP_PAGE_SIZE`); `from()`
 * sets it exactly. A field without a default is required, and a missing
 * value stops the process before the first request.
 */
export const AppConfig = makeConfig(
  'app',
  {
    pageSize: z.coerce.number().int().positive().default(20),
    // `secret()` hides the value in printouts and in error texts
    databaseUrl: secret(
      from('DATABASE_URL', z.url().default('postgresql://localhost/app')),
    ),
    apiToken: secret(from('API_TOKEN', z.string().min(1))),
  },
  // Derived fields have no variable of their own and are computed once,
  // when the section is validated
  (derived) => ({
    databaseHost: derived(['databaseUrl'], (url) => new URL(url).host),
  }),
);

/** The right to bind a source to the section keys; it does not read values */
export const appConfigKeys = AppConfig.keys;
```

The variable name is the prefix and the field name in upper snake case:
`app` plus `pageSize` gives `APP_PAGE_SIZE`. `from('NAME', schema)` sets the
name exactly, for values that already have a conventional one such as
`DATABASE_URL`.

A field without a default is required. A missing or malformed value stops
the process on the BOOTSTRAP phase, before the container exists and long
before the first request — this is why config is never read with
`process.env` inside a factory or a handler.

`secret()` hides a value in printouts and in the text of errors.
`.describe()` on the schema documents a field for whoever writes the
deployment manual; the framework does not read it.

## Derived fields

The third argument of `makeConfig` adds fields computed from the others:
`derived(['databaseUrl'], (url) => new URL(url).host)`. Dependencies are
named by field name and the compiler checks both the names and the types.
A derived field has no variable of its own, is not part of `.keys`, and is
computed once, while the section is validated. It inherits secrecy from its
dependencies.

## Reading a section

A section is a DI token. Inject it and read fields off it:

<!-- snippet: pager.ts#reading -->
```typescript
@Component([AppConfig])
export class Pager {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  size(): number {
    return this.config.pageSize;
  }
}
```

`Config<typeof Section>` is the type of the read side. There is no
`ConfigService` and no `get('some.key')`: a typo is a compile error.

Config never decides what the process runs. The features and the switches
come from the build argument — `app.build(argv(process.argv))` — and the
section is read only inside the container.

## Sources

Where values come from is an option of `run()`, not a field of the
declaration. `bind(source, { keys })` binds a source to the keys of a
section:

<!-- snippet: main.ts#sources -->
```typescript
await app.build(argv(process.argv)).run({
  config: [
    bind(dotenv('config/local.env'), {
      keys: appConfigKeys,
      optional: true,
    }),
    ...defaultSources,
  ],
});
```

- `keys` is `Section.keys` — the right to bind, which does not grant the
  right to read — or a glob, `'*'` by default.
- `optional: true` skips a source that did not come up; `timeout` bounds
  its `init()`, ten seconds by default.
- Bindings are tried in order; the first one that answers wins.
- Without the option `run()` takes `defaultSources`, the pair
  `[bind(env()), bind(dotenv('.env'), { optional: true })]`. A list of its
  own replaces that default whole, which is why a source of the
  application is written next to it.
- A source is any object implementing `ConfigSource`: `get(key)` is
  required, `watch()` is what makes a section reloadable.
- In a test, `bind(vars({ API_TOKEN: 'test' }))` is the whole list, so the
  test reads neither the environment nor a file.

A constant of the application is not a source. A value that does not
change between deployments belongs in `.default()` of the field schema,
where the compiler sees it.

**Do not read `process.env` or `process.argv` in the source.** These are
the two seams, and they are the only ones: a key of the environment is
declared in a config section and reaches the handler through the section,
the command line reaches `build()` through the `argv(process.argv)` marker
at the entry point. The `no-process-globals` rule holds this; a seam that
legitimately reads the process silences it with an `eslint-disable` that
states the reason.

`makeConfig.reloadable(prefix, fields)` declares a section whose values are
updated at run time. Read such a section through its accessor on every use;
a value copied into a constructor field will not change.
