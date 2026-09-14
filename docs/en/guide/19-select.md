# 19. Start only a part of the features

> Guide to the current API; verified against `951b4afd`.
> Target description: [design/composition.md](../design/composition.md), the
> "L2 — features, selection and switches" and "`check()`" sections. Why:
> entries [ideas.md](../../decisions/ideas.md)
> `[2026-07-08] Модульный монолит: фичи, select`,
> `[2026-09-02] Модель композиции: фича, плагин, операция` and
> `[2026-09-06] Переключатели состава: makeSwitch, pick и when, аргумент сборки; формы корня без фич`.

The application consists of the `users`, `notifications` and `ops` features.
Locally it starts as one process. In production the user API and the
operational endpoints are deployed separately, and each process must
bring up only its own features. The same code must build into all
three roles, and a wrong composition must stop the build, not the
first request.

## Pass the command line as the build argument

```typescript
// src/main.ts
import { app } from './app.js';

import { argv } from '@nestlingjs/app';

/**
 * The entry point. `--features users` brings up the users feature,
 * `--features all` brings up all of them, `--include-deps` adds the
 * features whose operations the selected ones call, and `--docs off`
 * removes the documentation from the composition.
 */
await app.build(argv(process.argv)).run();
```

`argv(process.argv)` is a marker: it carries a list of strings and
parses nothing. The declaration knows the flag schema, and the build
parses the flags. The core does not read `process.argv`: the entry
point passes the list.

The list is taken whole, together with the path to the executable and
the path to the script: the parser drops the first two entries, and it
needs the second one for the usage line of the help text. A sliced list
(`process.argv.slice(2)`) is rejected — otherwise the parser would lose
the first two flags, and the process would come up with a different
composition.

Configuration does not set the composition: a root section with keys
like `APP_FEATURES` no longer exists, and the environment does not
affect the feature selection.

## The flag schema and the argument shapes

The schema is derived from the declaration whole:

| Flag | Value |
|---|---|
| `--features` | `all` or names separated by commas: `--features users,ops` |
| `--include-deps` | no value: close the selection over the called operations |
| `--<switch name>` | one of the `makeSwitch` values: `--docs off` |
| `--help` | no value: prints the schema and exits with code `0` |

A value is written in two ways: `--docs off` and `--docs=off`. There
are no short flags, no flag grouping and no positional arguments.

The marker owns the process: an entry that receives `argv(process.argv)`
ends the process itself. The help text goes to `stdout` with exit code
`0`, and a failure goes to `stderr` with exit code `1`. The message of
the failure is printed with its chain of causes under it, and no stack.
The rule holds for all three entries that accept the marker, and it
covers a failure of any phase of the startup. The object shape does not
own the process: `run()` rejects its promise, `discover()` and `check()`
throw, and the caller catches the failure.

The second shape of the argument is an object; it is used by tests and
by an application with its own command-line parsing:

| Form | What it selects |
|---|---|
| `{ features: 'all' }` | every feature from `features:` |
| `{ features: 'users,ops' }` | features by name (spaces around the names are ignored) |
| `{ features: ['users', 'ops'] }` | the same as a list |
| `{ features, includeDeps: true }` | features by name plus the features whose operations they call |
| `{ features, docs: 'off' }` | the same features plus switch values |

If `features:` is set and there is no selection, every feature is
selected. The plugins from `plugins:` do not enter the selection: they
are in every process. A feature that is not selected is absent from the
process entirely: its providers are not created, its endpoints are not
registered, its implementations of operations do not subscribe. An
unknown feature name stops the build, and the error lists the available
ones, the same as two features with one name, an empty selection, and a
selection with no `features:`.

The command line is parsed strictly, and it refuses before phase 0: an
unknown flag lists the known ones, a value outside a switch dictionary
lists the allowed ones, a flag with no value lists the values of its
switch, and a positional argument is named in the message. A switch with
no default requires its flag.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev --features users --include-deps
```

```
[nestling] features: users, notifications; docs=on; transports: http, mcp, bus
[nestling] selection closed over calls: users + notifications
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не Bearer-токеном
```

One feature was selected, and there are two in the process.
`includeDeps: true` closes the selection over the called operations:
the `users` feature injects `CheckAddress.caller` and
`ForgetAddress.emitter`, the owner of both operations lives in
`notifications`, and it connects on its own. The second line of the output
shows what the closure added.

A call counts as a mention of `.caller` or `.emitter` in the
dependencies of a handler class or of any other provider. The closure
goes over `request` and `command`: they have exactly one owner. Events
take no part in the closure. An event may have no subscriber at all,
and a process with no subscriber for `users.registered` remains a
correct topology.

The `ops` feature does not connect: nobody calls its operations, and it
arrives only by an explicit selection.

```
[nestling] features: ops; docs=on; transports: http, mcp, bus
[nestling] selection closed over calls: ops (nothing added)
```

A build with the `'users'` selection and no `includeDeps` stops on the
WIRE phase, where callers are bound to the owners of the operations:

```
Operation 'notifications.check-address' (kind 'request') is injected as '.caller', but no
selected feature implements it and this build has no intercom, so the
call has nowhere to go. Either add the feature that implements it to the
build argument (or close the selection over calls with
'build({ features, includeDeps: true })'), or assign the intercom role
to a bus transport ('transports: [nats({ name: "events" })]' with
'intercom: "events"') when the owner lives in another process.
```

The error names the operation, the caller and two ways to fix it:
include the owner in the selection, or assign the intercom when the
owner works in another process. The entry point passed the marker, so
the message arrives in `stderr` with no stack, and the process exits
with code `1`.

## Switches: the second dimension of composition

The feature selection answers which areas a process brings up. A
switch answers which variant of the same area. The documentation is
needed in the dev environment and is not needed outside the perimeter,
and that is not a reason to set up a feature for the sake of one
plugin.

```typescript
// src/app.ts
export const DocsEnabled = makeSwitch('docs', { default: 'on' });

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    observability,
    auth,
    subscriptions,
    // With `docs=off` the plugin is entirely absent from the build
    DocsEnabled.when(openapi),
  ],
  switches: [DocsEnabled],
  // Two protocols on one socket: the recipe
  // [«Expose the operations to an agent over MCP»](../recipes/mcp.md)
  transports: [http({ server: api }), mcp({ … })],
});
```

`makeSwitch('docs', { default: 'on' })` declares a two-position switch
with the values `'on'` and `'off'`. An enumeration has a different
form: `makeSwitch('storage', ['s3', 'local'])`, and a branch is
declared by the table `Storage.pick({ s3: [...], local: [...] })`,
which must list every value. `when(x)` is short for
`pick({ on: x, off: [] })`.

A branch is a value, not a function: the composition of both branches
is read with no code running. So `check()` sees both, and so does a
person reading `app.ts`.

A branch stands in any list of units: a module's `providers:` and
`dependsOn:`, a feature's and a plugin's `modules:` and `endpoints:`,
the root's `endpoints:`, `providers:`, `modules:`, `plugins:` and
`transports:`. It is not in `features:`: the build argument chooses
the composition of features. It is not in `policies:`: an invariant is
either declared or it is not.

The root declares the `switches:` dictionary, and both the type of the
object shape of the argument and the command-line flag schema are
derived from it. A switch field with a default is optional, one with no
default is required, and a value outside the dictionary does not
compile:

```typescript
app.build({ features: 'all', docs: 'off' }); // ok
app.build({ features: 'all', doc: 'off' }); // does not compile: no such field
app.build({ features: 'all', docs: 'no' }); // does not compile: no such value
```

The runtime repeats the same four checks on the BUILD phase, for JS
consumers and for values that came from the command line: a value not
from the dictionary, a `pick` on a switch outside `switches:`, two
switches with one name, a value with no default that was not passed.
The `argv` marker gets these checks whole: the content of the command
line is known at run time, not at compile time.

The names `features`, `includeDeps`, `include-deps` and `help` belong to
the build argument: a switch with such a name is rejected when the
declaration is created.

A switch has no DI token: the choice cannot be injected. The
composition does not leak into the application's code, so a provider
cannot behave differently depending on how the application was
built: instead, it is absent from the graph entirely.

The selection is visible in the start line next to the features:

```
[nestling] features: users, notifications; docs=off; transports: http, mcp, bus
```

and in the `check()` report as the `switches` field.

## Plugins and checking every role with no sockets

```typescript
// src/app.spec.ts
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` is selected alone: there are no providers of the `users`
    // feature in the graph, and plugins are in every build
    await using testApp = await buildTest(app, {
      config: testConfig,
      args: 'ops',
    });

    expect(testApp.get(AuditOutcome)).not.toBeNull();
    expect(testApp.get(SubscriptionRegistry)).not.toBeNull();
    expect(testApp.get(ActivityHub)).toBeNull();
  });
```

Observability, authentication and the subscription registry connect
through `plugins:` and do not depend on the feature selection. There
are no providers of the `users` feature in this build.

```typescript
// src/app.spec.ts
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  switches: app.spec.switches,
  policies: app.spec.policies,
  transports: app.spec.transports,
});

/**
 * `check()` options: the structural check has no overrides, so the
 * secret values are bound to the section's keys by a source
 */
const CHECK_OPTIONS = { config: [bind(vars(testEnv), { keys: appConfigKeys })] };
```

The application's `check()` runs phases 0 and 1: parsing the build
argument, expanding the switch branches, registration, discovery,
`build()`, checking that the called operations are reachable, and
checking the policies. No constructor runs, `acquire`,
`@OnStart` and `serve` are not called, and no resource is acquired. It
throws the same errors that `run()` would throw on phases 0 and 1, and
it does not affect a later `run()` of the same application.
`checkTopologies(app, topologies)` from `@nestlingjs/testing` calls
`check()` for every build argument and collects the errors of every
variant into one message. The failure above — "the call has nowhere to
go" — arrives in the same phase, so a topology that would not come up is
visible in the matrix rather than on the first run.

The composition with no graph gives the declaration's third entry
point: `discover(args)`. It runs only phase 0 and returns the
endpoints with the names of the units that declared them: what the
application would answer with this argument. The call is synchronous,
and it brings up no configuration sources. Graph errors remain the job
of `check()`. The OpenAPI document in CI is built from it
([chapter 13](./13-openapi-and-client.md)).

`check()` accepts no overrides: it checks the honest graph. Secrets
come through the `config` option, the same `bind()` list as `run()`
takes — the declaration has no bindings at all. The `API_TOKEN` and
`WEBHOOK_SECRET` secrets are needed here too, because `build()` creates
the configuration section.

```typescript
// src/app.spec.ts
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const reports = await checkTopologies(
      checked,
      [
        { features: 'all' },
        { features: 'users', includeDeps: true },
        { features: 'ops' },
      ],
      CHECK_OPTIONS,
    );

    // `users` calls `notifications.check-address`, so the closure over
    // the operations pulls in the mailing feature. Nobody calls `ops`,
    // and it arrives only by an explicit selection
    expect(reports[1].report.features).toEqual(['users', 'notifications']);
    expect(
      reports[2].report.endpoints.map(({ pattern }) => pattern).sort(),
    ).toEqual([
      'DELETE /ops/subscriptions/:id',
      'GET /healthz',
      'GET /openapi.json',
      'GET /ops/subscriptions',
      'GET /ops/subscriptions/live',
      'GET /readyz',
      'subscriptions.closed@ops',
      'subscriptions.opened@ops',
    ]);
  });
```

The result contains a `{ args, report }` pair for every variant. The
report lists `features`, `switches`, `endpoints` with the pattern, the
transport and the `detached` reason, `transports`, and `operations`.
In the `ops` role's report, the `GET /openapi.json` endpoint belongs
to the documentation plugin, and the implementations of operations are
visible under names like `subscriptions.opened@ops`.

```typescript
// src/app.spec.ts
  it("проверяет политики и перечисляет detached-endpoint'ы в отчёте", async () => {
    const [{ report }] = await checkTopologies(
      checked,
      [{ features: 'all' }],
      CHECK_OPTIONS,
    );

    expect(
      report.endpoints
        .filter(({ detached }) => detached !== undefined)
        .map(({ pattern }) => pattern)
        .sort(),
    ).toEqual([
      'GET /healthz',
      'GET /readyz',
      'POST /hooks/users',
      'POST /login',
    ]);
  });
```

```typescript
// src/app.spec.ts
  it('проверяет обе ветки переключателя документации', async () => {
    const [withDocs, withoutDocs] = await checkTopologies(
      checked,
      [
        { features: 'all', docs: 'on' },
        { features: 'all', docs: 'off' },
      ],
      CHECK_OPTIONS,
    );

    expect(withDocs.report.switches).toEqual({ docs: 'on' });
    expect(withoutDocs.report.switches).toEqual({ docs: 'off' });
  });
```

A topology is described by the whole object shape of the argument, so
the matrix goes through the feature selection and the switch branches as
one list. The `argv` marker is not accepted as a list item: the matrix
lists the topologies in code rather than taking them from the command
line. A branch that builds only in the dev environment is checked by the
same test as the rest.

The policies from chapter [10](./10-auth.md) are checked in every
topology of the matrix, not only in the full build. An invariant
that holds at the `all` selection and breaks on a subset is visible
in the test, not at deployment. The `detached` reasons arrive as
values in the report: the test compares a list rather than reading
console output.

```bash
yarn test
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev --features ops
```

The roles build separately, but for now they run in one process:
[20. Spread the features across processes](./20-split.md).
