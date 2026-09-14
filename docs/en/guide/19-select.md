# 19. Start only a part of the features

> Guide to the current API; verified against `46971d4e`.
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

## Read the build argument before the container

```typescript
// src/main.ts
import { app } from './app.js';

import { from, load, makeConfig } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * The root's section: the build argument is read before the
 * container.
 *
 * The `root` prefix tells it apart from the `app` section in
 * `app.config.ts`, the feature selection key is set exactly
 * (`APP_FEATURES`), and the switch values are described by their
 * schemas.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
  docs: from('APP_DOCS', Docs.schema),
});

/**
 * The entry point. `APP_FEATURES=users` brings up the users feature
 * and the features whose operations it calls. `APP_FEATURES=all`
 * brings up all of them. `APP_DOCS=off` removes the documentation
 * from the composition.
 */
const cfg = load(RootConfig);

await app.build({ ...cfg, includeDeps: true }).run();
```

`load(section)` reads the values before the container is built:
synchronously and only from `process.env`. It works this way because
the build argument determines the composition of the container, and
a section inside the container would appear only after the selection.
The sources bound by the `config` option of `run()` take no part in
this read. This is the only configuration read before the build.

The `APP_FEATURES` key is set through `from()`: the root has its own
`root` prefix, because the `app` prefix is already taken by the
application's section.

The section's fields are named the same as the build argument's
fields, so `cfg` fits `build` whole. The name `docs` is the switch's
name, and an extra field in this object does not compile.

## Argument shapes and the closure over calls

| Form | What it selects |
|---|---|
| `'all'` | every feature from `features:` |
| `'users,ops'` | features by name (spaces around the names are ignored) |
| `['users', 'ops']` | the same as a list |
| `{ features, includeDeps: true }` | features by name plus the features whose operations they call |
| `{ features, docs: 'off' }` | the same features plus switch values |

The string form is needed because the selection comes from an
environment variable. With it, the switch values are taken from their
defaults. If `features:` is set and there is no selection, every
feature is selected. The plugins from `plugins:` do not enter the
selection: they are in every process. A feature that is not selected
is absent from the process entirely: its providers are not created,
its endpoints are not registered, its implementations of operations do
not subscribe. An unknown feature name stops the build, and the
error lists the available ones, the same as two features with one
name, an empty selection, and a selection with no `features:`.

```bash
APP_FEATURES=users API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev
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

A build with the `'users'` selection and no `includeDeps` stops on
the BUILD phase:

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
owner works in another process.

## Switches: the second dimension of composition

The feature selection answers which areas a process brings up. A
switch answers which variant of the same area. The documentation is
needed in the dev environment and is not needed outside the perimeter,
and that is not a reason to set up a feature for the sake of one
plugin.

```typescript
// src/app.ts
export const Docs = makeSwitch('docs', { default: 'on' });

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    appObservability,
    appAuth,
    appSubscriptions,
    // With `docs=off` the plugin is entirely absent from the build
    Docs.when(appOpenapi),
  ],
  switches: [Docs],
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

The root declares the `switches:` dictionary, and the type of the
build argument is derived from it. A switch field with a default is
optional, one with no default is required, and a value outside the
dictionary does not compile:

```typescript
app.build({ features: 'all', docs: 'off' }); // ok
app.build({ features: 'all', doc: 'off' }); // does not compile: no such field
app.build({ features: 'all', docs: 'no' }); // does not compile: no such value
```

The runtime repeats the same four checks on the BUILD phase, for JS
consumers and for values that came from the environment: a value not
from the dictionary, a `pick` on a switch outside `switches:`, two
switches with one name, a value with no default that was not passed.

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
`build()` and checking the policies. No constructor runs, `acquire`,
`@OnStart` and `serve` are not called, and no resource is acquired. It
throws the same errors that `run()` would throw on phases 0 and 1, and
it does not affect a later `run()` of the same application.
`checkTopologies(app, topologies)` from `@nestlingjs/testing` calls
`check()` for every build argument and collects the errors of every
variant into one message.

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
    const usersWithDeps = { features: 'users', includeDeps: true } as const;
    const reports = await checkTopologies(
      checked,
      ['all', usersWithDeps, 'ops'],
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
    const [{ report }] = await checkTopologies(checked, ['all'], CHECK_OPTIONS);

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

A topology is described by the whole build argument, so the matrix
goes through the feature selection and the switch branches as one
list. A branch that builds only in the dev environment is checked
by the same test as the rest.

The policies from chapter [10](./10-auth.md) are checked in every
topology of the matrix, not only in the full build. An invariant
that holds at the `'all'` selection and breaks on a subset is visible
in the test, not at deployment. The `detached` reasons arrive as
values in the report: the test compares a list rather than reading
console output.

```bash
yarn test
APP_FEATURES=ops API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev
```

The roles build separately, but for now they run in one process:
[20. Spread the features across processes](./20-split.md).
