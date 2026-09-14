# 14. Separate the second area

> Guide to the current API; verified against `4a206018`.
> Target description: [design/composition.md](../design/composition.md), the
> "Feature boundary" and "Plugin" sections, and
> [design/operations.md](../design/operations.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-09-02] Модель композиции: фича, плагин, операция`,
> `[2026-07-08] Порты: межфичевое общение через контракты` and
> `[2026-07-08] Kernel/user space; конфиг как token-families; плагины`.

A letter goes out to every new user, and another team owns the mailing.
The mailing code must live apart: it has its own services, its own tests
and its own owner. The users feature must not inject the mailing service,
because one day the mailing moves into a separate process, and the
registration code must not change because of it. The observability layer
and the Bearer token check stay shared between both areas.

The service from part 1 grows into an application. The files are laid out
by area: the features live in `src/features/<name>/`, the shared
infrastructure in `src/plugins/<name>/`, the application declaration in
`src/app.ts`. The code of the endpoints, the store and the config does not
change.

## The second feature

```typescript
// src/features/notifications/suppressions.ts
@Component([])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  /** The reason for the refusal, or `undefined` when the address is fine */
  reasonFor(email: string): string | undefined {
    return this.#blocked.get(email);
  }

  /** Takes the address out of the mailings */
  suppress(email: string, reason: string): void {
    this.#blocked.set(email, reason);
  }
}
```

```typescript
// src/features/notifications/notifications.feature.ts
export const NotificationsFeature = makeFeature({
  name: 'notifications',
  providers: [Suppressions, Mailer],
  endpoints: [CheckAddressImpl, WelcomeEmail, ForgetAddressImpl],
});
```

The `notifications` feature is declared the same way as `users`: a name,
providers and endpoints. `Suppressions` is the list of addresses that
letters do not go to; the knowledge belongs to whoever sends those
letters. The class is not exported outward and does not end up in the
`deps` of other features.

## The feature boundary

A feature cannot depend on the provider of another feature. If the
`users` feature declares a `UsersReport` provider with
`@Component([Suppressions])`, the build stops on the BUILD phase:

```
1 edge(s) cross a feature boundary:

  - Feature 'users' depends on feature 'notifications' by DI token: 'UsersReport'
    injects 'Suppressions'. Features are connected by operations only — a
    DI token does not survive a process boundary, so this edge breaks the
    moment the two features are deployed apart. Declare the call as an
    operation (makeRequest / makeCommand), inject its '.caller' and
    implement it in 'notifications'.
```

The check runs on the built graph and tells apart three kinds of
edges.

| Edge | Verdict |
|---|---|
| a feature provider depends on a provider of another feature | build error |
| a feature provider depends on a plugin provider | allowed |
| a plugin provider depends on a feature provider | build error |

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

/** The "address rejected" failure. It arrives over the network as a code and is restored into a `Fail` */
export const AddressRejected = makeFail('conflict:address_rejected', {
  details: z.object({ email: z.string(), reason: z.string() }),
  message: (d) => `Address ${d.email} is not deliverable: ${d.reason}`,
});

export const CheckAddressInput = z.object({ email: z.string() });

export type CheckAddressInput = z.infer<typeof CheckAddressInput>;

export const CheckAddress = makeRequest({
  name: 'notifications.check-address',
  input: CheckAddressInput,
  output: z.object({ deliverable: z.boolean() }),
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
    const reason = this.suppressions.reasonFor(payload.email);

    if (reason !== undefined) {
      this.logger.info('address rejected', { email: payload.email });

      // The caller gets a `Fail` and recognizes it through `AddressRejected.is()`
      return AddressRejected({ email: payload.email, reason });
    }

    return { deliverable: true };
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
implementation is absent from the build stops the build: the call
would have nowhere to go. Two owners of one operation also stop the
build.

## Calling through the caller

```typescript
// src/features/users/endpoints/create-user.endpoint.ts
const CHECK_BUDGET_MS = 500;

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
    const checked = await this.addresses.call(
      { email: payload.email },
      { deadline: deadlineIn(CHECK_BUDGET_MS) },
    );

    if (checked.isFail) {
      // The neighbour's failure is declared in `errors:` of the operation
      // and goes to the client as is. An exhausted budget arrives as the
      // kernel code `timeout`: kernel failures enter `Output` without a
      // declaration, so no type cast is needed here
      return checked;
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
the kernel codes — the type of `checked` holds nothing else, and a
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

A registration to a rejected address gets `409`:

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Eve","email":"eve@example.invalid"}'
# {"type":"urn:error:conflict:address_rejected","title":"Conflict","status":409,
#  "detail":"Address eve@example.invalid is not deliverable: domain does not accept mail",
#  "details":{"email":"eve@example.invalid","reason":"domain does not accept mail"}}
```

## What is shared goes into plugins

Both features need the `traced` layer. A provider that two
features depend on is declared as a plugin:

```typescript
// src/plugins/observability/observability.plugin.ts
export const observability: Plugin = makePlugin({
  name: 'app-observability',
  // The step class of the `traced` layer: without registering it the layer will not build
  providers: [AuditOutcome],
});
```

A plugin is cross-cutting infrastructure. `makePlugin` accepts the same
thing as `makeFeature`: a name, providers, endpoints if needed. The
difference is in the role: a plugin is listed in `plugins:` of the root,
is present in every process, and features reach it by DI tokens.
`observability` has no parameters: the kernel gives the step its
logger, and `NESTLING_LOG_LEVEL` of the kernel logger sets the record
level ([chapter 9](./09-logging.md)), so the plugin has one value and it
is declared right here.

A parameterized plugin is a function that returns a value:

```typescript
// src/ops/ops.plugin.ts (fragment)
export const subscriptions = makeSubscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: false,
});
```

`makeSubscriptions(options)` from the `@nestlingjs/subscriptions` package
builds a subscription registry. `identity` names a context variable:
the registry takes its value by the key and does not know the shape of
the accumulated input. `labels` is a function of the context; the
accumulated input is out of its reach too, and the values of variables
come to it as arguments from
`computed([TenantId, UserId], (_ctx, tenant, user) => …)`. The
`publish: true` flag would turn on publishing subscription open and close
events: whoever collects the picture across all the processes listens to
them.

The DI token check is built the same way:

```typescript
// src/plugins/auth/index.ts
export const auth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

export const authed = compose(
  traced,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

The `Authenticate` step class is needed by the endpoints of the `users`
and `ops` features, so a plugin registers it. A module reachable from two
features must be a plugin: as long as it has two owners, the edge into it
cannot be assigned to either feature, and the build stops with a
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
fits a feature with many providers, or one already built into a
module for another application. The `notifications` feature gets by with
`providers:`: it has two services. In both cases the feature, not the
module, lists the endpoints.

## The application declaration

```typescript
// src/app.ts
export const app = makeApp({
  features: [UsersFeature, NotificationsFeature],
  plugins: [
    observability,
    auth,
    subscriptions,
    // The documentation plugin stands under a composition switch — chapter
    // 19 introduces it: [chapter 19](./19-select.md)
    DocsEnabled.when(openapi),
  ],
  switches: [DocsEnabled],
  // Two protocols on one socket: the recipe
  // [«Expose the operations to an agent over MCP»](../recipes/mcp.md)
  transports: [http({ server: api }), mcp({ … })],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      traced,
      'traced',
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
second `makeSubscriptions({ … })` call would give a second plugin with the
same name, and the build would stop.

## Check

```typescript
// src/app.spec.ts
it('возвращает отказ соседней фичи на отвергнутый адрес', async () => {
  await using testApp = await buildTest(app, {
    ...testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // The failure crossed the boundary of the calling endpoint without being
  // replaced with `InternalError`: its `errors:` declares the neighbour's
  // failure alongside its own
  expect(await createUser(testApp, 'eve@example.invalid')).toMatchObject({
    isSuccess: false,
    status: 'conflict',
    value: { code: AddressRejected.code },
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
curl -s -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
```

The same run with `NESTLING_PORTS_DISPATCH=always-remote` sends the
`notifications.check-address` call through the in-process bus.

The mailing learns about a new user not by a request, but by an event:
[15. Tell the neighbours what happened](./15-events.md).
