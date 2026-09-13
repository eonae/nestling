# 14. Separate the second area

> Guide to the current API; verified against `da754bb4`.
> Target description: [design/composition.md](../design/composition.md), the
> "Feature boundary" and "Plugin" sections, and
> [design/operations.md](../design/operations.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-09-02] Модель композиции: фича, плагин, операция`,
> `[2026-07-08] Порты: межфичевое общение через контракты` and
> `[2026-07-08] Kernel/user space; конфиг как token-families; плагины`.

A quota limits user registration, and another team owns it. The quota code
must live apart: it has its own services, its own tests and its own
owner. The users feature must not inject the quota service, because one
day quotas will move into a separate process, and the registration code
must not change because of it. The observability layer and the DI token
check stay shared between both areas.

The service from part 1 continues in `app-with-http`. The files are laid
out by area: the features live in `src/features/<name>/`, the shared
infrastructure in `src/plugins/<name>/`, the application declaration in
`src/app.ts`. The code of the endpoints, the store and the config is the
same as in `users-service`.

## The second feature

```typescript
// src/features/notifications/suppressions.ts
@Component([])
export class Suppressions {
  /** The user limit; deliberately small in the example */
  readonly limit = 5;

  #used = 0;

  /** Claims a spot or answers "no spots left" */
  claim(): { ok: true; remaining: number } | { ok: false } {
    if (this.#used >= this.limit) {
      return { ok: false };
    }

    this.#used += 1;

    return { ok: true, remaining: this.limit - this.#used };
  }
}
```

```typescript
// src/features/notifications/notifications.feature.ts
export const NotificationsFeature = makeFeature({
  name: 'notifications',
  providers: [Suppressions, Suppressions],
  endpoints: [CheckAddressImpl, WelcomeEmail, ForgetAddressImpl],
});
```

The `notifications` feature is declared the same way as `users`: a name,
providers and endpoints. `Suppressions` is not exported outward and does
not end up in the `deps` of other features.

## The feature boundary

A feature cannot depend on the provider of another feature. If the
`users` feature declares a `UsersReport` provider with
`@Component([Suppressions])`, the assembly stops on the ASSEMBLE phase:

```
1 edge(s) cross a feature boundary:

  - Feature 'users' depends on feature 'notifications' by DI token: 'UsersReport'
    injects 'Suppressions'. Features are connected by operations only — a
    DI token does not survive a process boundary, so this edge breaks the
    moment the two features are deployed apart. Declare the call as an
    operation (makeRequest / makeCommand), inject its '.caller' and
    implement it in 'notifications'.
```

The check runs on the assembled graph and tells apart three kinds of
edges.

| Edge | Verdict |
|---|---|
| a feature provider depends on a provider of another feature | assembly error |
| a feature provider depends on a plugin provider | allowed |
| a plugin provider depends on a feature provider | assembly error |

A feature is addressed by operations, a plugin by DI tokens. A DI token
works only inside a process, an operation has an address and schemas and
works over any transport.

## An operation instead of a DI token

```typescript
// src/operations.ts
import {
  makeFail,
  makeCommand,
  makeEvent,
  makeRequest,
} from '@nestlingjs/operations';
import { z } from 'zod';

/** The "quota exhausted" failure. It arrives over the network as a code and is restored into a `Fail` */
export const AddressRejected = makeFail('conflict:address_rejected', {
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

export const CheckAddressInput = z.object({ email: z.string() });

export type CheckAddressInput = z.infer<typeof CheckAddressInput>;

export const CheckAddress = makeRequest({
  name: 'notifications.check-address',
  input: CheckAddressInput,
  output: z.object({ remaining: z.number() }),
  errors: [AddressRejected],
});
// …
```

An operation is the unit of communication between features: a name, the
`input` and `output` schemas, the `errors` list. It is declared in a file
outside both features, because it belongs neither to the caller nor to the
implementer. The file imports only `@nestlingjs/operations` and `zod`, so
a frontend can import the operation too.

`makeRequest` declares an operation of the `request` kind: the caller
waits for an `Ok` or `Fail` response, and the operation has exactly one
owner.

## The implementation in the owning feature

```typescript
// src/features/notifications/check-address.endpoint.ts
@Handler([Suppressions, Logger$.auto])
class CheckAddressHandler {
  constructor(
    private readonly suppressions: Suppressions,
    private readonly logger: Logger,
  ) {}

  async handle(payload: CheckAddressInput) {
    const claimed = this.notifications.check-address();

    if (!claimed.ok) {
      this.logger.info('quota exhausted', { email: payload.email });

      // The caller gets a `Fail` and recognizes it through `AddressRejected.is()`
      return AddressRejected({ limit: this.suppressions.size });
    }

    return { remaining: claimed.remaining };
  }
}

export const CheckAddressImpl = implement(CheckAddress, {
  handler: CheckAddressHandler,
});
```

`implement(Operation, { handler })` creates an endpoint declaration on the
bus transport. The constructor and the address set it apart from
`httpEndpoint`: the name of the operation serves as the pattern. The
`input`, `output` and `errors` schemas are taken from the operation and
are not repeated in the implementation — declaring any of them again is a
compilation error. The rest is shared with `httpEndpoint`: a handler
class, the input checked against the schema, a failure outside the
`errors` list replaced with `InternalError`. The implementation is listed
in the `endpoints:` of the feature next to the HTTP endpoints.

An operation of the `request` kind whose caller is injected but whose
implementation is absent from the assembly stops the assembly: the call
would have nowhere to go. Two owners of one operation also stop the
assembly.

## Calling through the caller

```typescript
// src/features/users/endpoints/create-user.endpoint.ts
const QUOTA_CALL_BUDGET_MS = 500;

@Handler([
  UsersRepository$,
  CheckAddress.caller,
  // …
])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: Port<typeof CheckAddress>,
    // …
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof AddressRejected> {
    if (await this.users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }
    // …
    const claimed = await this.addresses.call(
      { email: payload.email },
      { deadline: deadlineIn(QUOTA_CALL_BUDGET_MS) },
    );

    if (claimed.isFail) {
      // The neighbour's failure is declared in `errors:` of the operation
      // and goes to the client as is. An exhausted budget arrives as the
      // kernel code `timeout`: kernel failures enter `Output` without a
      // declaration, so no type cast is needed here
      return claimed;
    }

    const user = await this.users.insert({
      name: payload.name,
      email: payload.email,
    });
    // …
    return Ok.created(user);
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`CheckAddress.caller` is the DI token of the caller. It is listed in the
role decorator as an ordinary dependency, and the handler gets an object
of type `Port<typeof CheckAddress>` with a `call(input, meta?)` method. The
call is always asynchronous and always returns `Ok` or `Fail`, even when
the implementation runs in the same process. The caller parses the
failure: the set of its responses is closed — the declared failures plus
the kernel codes — the type of `claimed` holds nothing else, and a
`default` branch at the call site is not needed.

The second argument of `call` is the call parameters. `deadline` sets the
time budget as a moment, not a duration: `deadlineIn(500)` computes the
moment from milliseconds. There is no budget by default. An exhausted
budget arrives as a failure with the kernel code `timeout`; it is not
declared in `errors:`, and neither is `internal_error`.

The neighbour's `AddressRejected` failure reaches the client, because the
`users.create` operation folds the failures of `CheckAddress` in through
`errorsOf` alongside its own; a failure not listed in the `errors:` of
the calling endpoint is replaced with `InternalError` on the way out of
the pipeline. `Unauthorized` stays in the list of the operation even
though the endpoint no longer declares it: the `authed` layer declared
this failure, and the operation is a contract for the client, which does
not see the pipeline of the implementation:

```typescript
// src/api/operations.ts
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, ...errorsOf(CheckAddress), Unauthorized],
  // …
});
```

`errorsOf(CheckAddress)` returns the `errors:` of the `CheckAddress`
operation as the same value: the spread `...errorsOf(CheckAddress)`
replaces the manual import and listing of `AddressRejected`, and the
handler's type stays the same as with the failure listed directly.

`httpEndpoint.implement` checks two sets against each other: every failure
declared by the layers of its pipeline must be in the `errors:` of the
operation. The `authed` layer declares `Unauthorized`, so the operation
lists it. If it did not, the `pipeline` slot would not compile, and the
constructor would throw an error when the declaration is created, naming
the missing codes.

The sixth registration in a row gets `429`:

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 6","email":"user6@example.com"}'
# {"error":"User quota of 5 is exhausted","code":"conflict:address_rejected","details":{"limit":5}}
```

## What is shared goes into plugins

Both features need the `observability` layer. A provider that two
features depend on is declared as a plugin:

```typescript
// src/plugins/observability/observability.plugin.ts
export const appObservability: Plugin = makePlugin({
  name: 'app-observability',
  // The unit class of the observability layer: without registering it the layer will not assemble
  providers: [AuditOutcome],
});
```

A plugin is cross-cutting infrastructure. `makePlugin` accepts the same
thing as `makeFeature`: a name, providers, endpoints if needed. The
difference is in the role: a plugin is listed in `plugins:` of the root,
is present in every process, and features reach it by DI tokens.
`appObservability` has no parameters: the kernel gives the unit its
logger, and `NESTLING_LOG_LEVEL` of the kernel logger sets the record
level ([chapter 9](./09-logging.md)), so the plugin has one value and it
is declared right here.

A parameterized plugin is a function that returns a value:

```typescript
// src/app.ts (fragment)
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});
```

`subscriptions(options)` from the `@nestlingjs/subscriptions` package
assembles a subscription registry. The `identity` and `labels` parameters
are functions that compute the subscriber and the record labels from the
context of the request. The `node` parameter is the name of the node in
the registry. The `publish: true` flag turns on publishing subscription
open and close events.

The DI token check is built the same way:

```typescript
// src/plugins/auth/index.ts
export const appAuth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

The `Authenticate` unit class is needed by the endpoints of the `users`
and `ops` features, so a plugin registers it. A module reachable from two
features must be a plugin: as long as it has two owners, the edge into it
cannot be assigned to either feature, and the assembly stops with a
suggestion to move the module into `plugins:`.

## Modules inside a feature

```typescript
// src/features/users/users.feature.ts
export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    Database,
    classProvider(UsersRepository$, DbUsersRepository),
    ActivityHub,
    AuditDeletion,
    VerifySignature,
  ],
});

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    ListUsers,
    GetUser,
    CreateUser,
    // …
  ],
});
```

A feature accepts providers two ways: as a `providers:` list or as a
`modules:` list of modules. A module groups providers under a name, and
the `dependsOn` field lists the modules it cannot work without. A module
fits a feature with many providers, or one already assembled into a
module for another application. The `notifications` feature gets by with
`providers:`: it has two services. In both cases the feature, not the
module, lists the endpoints.

## The application declaration

```typescript
// src/app.ts
export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    appObservability,
    appAuth,
    appSubscriptions,
    // The documentation plugin stands under a composition switch — chapter
    // 19 introduces it: [chapter 19](./19-select.md)
    Docs.when(appOpenapi),
  ],
  switches: [Docs],
  // Two protocols on one socket: the recipe
  // [«Expose the operations to an agent over MCP»](../recipes/mcp.md)
  transports: [api, http({ server: api }), mcp({ … })],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
    // …
  ],
});
```

The value of a parameterized plugin is created once and imported: a
second `subscriptions({ … })` call would give a second plugin with the
same name, and the assembly would stop.

## Check

```typescript
// src/app.spec.ts
it('возвращает отказ соседней фичи при исчерпанной квоте', async () => {
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  for (const index of [1, 2, 3, 4, 5]) {
    unwrap(await createUser(testApp, String(index)));
  }

  // The failure crossed the boundary of the calling endpoint without being
  // replaced with `InternalError`: its `errors:` declares the neighbour's
  // failure alongside its own
  expect(await createUser(testApp, 'sixth')).toMatchObject({
    isSuccess: false,
    status: 'too_many_requests',
    value: { code: AddressRejected.code, details: { limit: 5 } },
  });
});
```

The implementation of an operation is called in the test the same way as
an HTTP endpoint: `testApp.call(CheckAddressImpl, { email })`. A separate
test gets the caller through `testApp.get(CheckAddress.caller)` and calls it
with an expired `deadline`: the response arrives with the `timeout` code,
and the implementation is not called.

One more test runs registration under two dispatch policies. The policy is
set by the `NESTLING_PORTS_DISPATCH` config: `local-first` calls the
implementation from the same process directly, `always-remote` sends every
call through the bus as a message. The call code does not change.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev
for i in 1 2 3 4 5 6; do
  curl -s -X POST localhost:3000/users \
    -H 'authorization: Bearer secret' -H 'content-type: application/json' \
    -d "{\"name\":\"User $i\",\"email\":\"user$i@example.com\"}"; echo
done
```

The same run with `NESTLING_PORTS_DISPATCH=always-remote` sends the
`notifications.check-address` call through the in-process bus.

Quotas learn about a new user not by a request, but by an event:
[15. Tell the neighbours what happened](./15-events.md).
