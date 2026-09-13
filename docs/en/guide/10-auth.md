# 10. Let only your own through

> Guide to the current API; verified against `648a64dc`.
> Target description: [design/pipeline.md](../design/pipeline.md) and
> [design/composition.md](../design/composition.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-09-04] Отказы слоя: объявление в .pre(step, { errors }), канал return у pre-шага, эффективное множество errors`
> and `[2026-09-12] Транзакционный приём`.

Anyone can read the list of users, but only someone who has presented a
Bearer token can create, change and delete them. The check runs before the
handler and answers `401` with a machine code. It must be impossible to
forget it on a new endpoint.

```typescript
// src/errors.ts
import { makeFail } from '@nestlingjs/operations';

/** The failure of the Bearer token check. The pre-step of the `authed` layer returns it. */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
```

The failure is declared the same way as the handler failures in
[chapter 4](./04-errors.md). The transport translates the `unauthorized`
status into the HTTP code `401`.

```typescript
// src/auth.ts
import type { Config, EmptyInput, ExtendableContext } from '@nestlingjs/app';
import { compose, makePipeline } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/** Who the request runs on behalf of */
export interface Caller {
  id: string;
}

@Handler([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(
    ctx: ExtendableContext<EmptyInput>,
  ): { caller: Caller } | ReturnType<typeof Unauthorized> {
    const header = ctx.raw.attributes.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || token !== this.config.apiToken) {
      return Unauthorized();
    }

    return { caller: { id: 'api-token' } };
  }
}

export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

`Authenticate` is a pre-step in the form of a class. It needs the config
section from [chapter 7](./07-config.md), so the dependency is declared in
the role decorator. The role here is `@Handler`: the step has a `handle`
method. The class itself is registered in the `providers:` of the feature.

The `handle` method gets the context of the request. `ctx.raw.attributes`
holds the headers of the HTTP request; header names are lowercased. The
step compares the Bearer token with the `apiToken` value from the config
section.

The step finishes in one of two ways.

- `return Unauthorized()` stops the pipeline: the handler is not called,
  and the response phase gets this failure.
- `return { caller: … }` adds a field to the context. The following steps
  and the handler will see it.

The failure of a step is declared at the point of connection — the second
argument of `.pre`. Returning a failure outside this list is impossible:
the compiler rejects the step right in `.pre`. The `caller` field does not
reach the accumulated context on a failure: the runtime learns of the
failure before the result is written into the context.

`authed` is a new layer, composed from two: `compose(outer, inner)`. The
pre-steps of the outer layer run earlier, so `requestId` is already in the
context by the time the Bearer token is checked, and the audit line is
written for rejected requests too. The `authed` layer descends from
`observability` — the build policy below relies on this.

A layer can declare a requirement on the outer context with the
`makePipeline<{ caller: Caller }>()` signature. Composing such a layer with
an outer layer that does not add the `caller` field does not compile.

## Connecting the layer and the policies

```typescript
// src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint.delete('/users/:id', {
  input: DeleteUserInput,
  errors: [UserNotFound],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: authed,
  handler: DeleteUserHandler,
});
```

The endpoint connects `authed` instead of `observability`. `Unauthorized`
is not listed in `errors:`: the layer declared it. The failure set of an
endpoint is made up of the `errors:` dictionary and the failures of its
layers, and this set gets the type of the handler, the check at the
boundary and the OpenAPI document. A failure from a pre-step passes the
same check as a handler failure: the pipeline boundary replaces an
undeclared failure with `internal_error` at code `500`.

A pre-step has three outcomes. The first two are visible here: an addition
to the context (`{ caller }`) and a failure (`Unauthorized()`). The third
is an early success: the step returns `done()`, and the endpoint finishes
with a success without reaching the handler.

An early success is declared with the same second argument:
`.pre(step, { done: true })`. A declaration with such a layer must have no
`output` — an early success carries no value — and this is checked when it
is created. A step that returns `done()` without declaring it drops the
request with an error that names the fix in its text.

The first use of this channel was the deduplication layer on message
receipt ([chapter 16](./16-durable-events.md)): a repeat delivery finishes
with a success, and the handler is not called.

The same failure can be declared both on the layer and in `errors:` — the
set counts it once. The reverse order of work also gets simpler: a new
endpoint with the `authed` layer answers `401` and shows this response in
OpenAPI, without listing someone else's failure of its own. The `hasLayer`
policy below requires the layer on every mutating endpoint, so `401`
appears on every one of them at once.

The handler gets the fields that the pre-steps put into the context as the
second argument, together with the reserved `signal` key — the
cancellation signal of the request. The handlers of the example do not use
the identity of the caller, but they could:

```typescript
// illustration; the handlers of the example do not read the caller field
handle:
  (users: UsersRepository) =>
  async (payload: DeleteUserInput, meta: { caller: Caller }) => {
    // meta.caller.id
  },
```

Check the responses:

```bash
curl -X DELETE http://localhost:3000/users/2
# {"type":"urn:error:unauthorized","title":"Unauthorized","status":401,
#  "detail":"Bearer token is missing or invalid"} 401
curl -X DELETE -H 'authorization: Bearer secret' http://localhost:3000/users/2
# 204
```

A new endpoint with `pipeline: observability` compiles and works, but lets
everyone through. So that such an endpoint does not reach production, the
root declares build policies:

```typescript
// src/app.ts
import { everyEndpoint } from '@nestlingjs/app';
import { http, HttpTransport$ } from '@nestlingjs/transport.http';

export const app = makeApp({
  features: [UsersFeature],
  // …
  transports: [http()],
  policies: [
    // Every HTTP endpoint has the observability layer
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Every endpoint that changes data checks the Bearer token
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
  ],
});
```

A policy is an invariant over the built graph. `everyEndpoint(filter)`
selects endpoints: by the DI token of the transport or by a regular
expression on the pattern. `.hasLayer(layer, label)` requires that the
pipeline of every selected endpoint descend from this layer. `label`
reaches the text of the violation.

A layer is compared by reference, not by content: a copy with the same
content, declared in another file, does not pass the policy, and the check
cannot be bypassed by redeclaring the layer.

Policies are checked on the BUILD phase: before the instances are
created, before the socket opens. A `POST /rogue` endpoint with the
`observability` layer stops the start with this message:

```
1 endpoint violation(s) of build policies:

policy: every endpoint (pattern /^(POST|PATCH|DELETE) /) has layer 'authed'
  - POST /rogue (http, module 'rogue'): its pipeline is not composed from layer 'authed'

Fix each handle by composing the required layer into its 'pipeline:', or opt out deliberately with detached: '<reason>' in its declaration.
```

The message names the endpoint, the policy and two ways to fix it. An
endpoint without `pipeline:` violates the policy too: for the "endpoint is
protected" invariant, no pipeline and no layer are indistinguishable.

## The second check: the context variable is declared

In [chapter 9](./09-logging.md) the store read the request identifier
through `Ctx(RequestId)`. The reader gives back the value that the pre-step
of the layer put there. If the route has no layer connected, `peek()`
returns `undefined`, and `get()` throws an error. The compiler does not see
such an omission: the store has no type for the input of the request, and
the reader is the same for every route.

The presence of the variable requires a second predicate:

```typescript
// src/app.ts
everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
  RequestId,
  'requestId',
),
```

`hasVar(variable, label)` requires that the pipeline of the selected
endpoint declare this variable. A declaration is a pre-step of the shape
`Var.provide(…)`; `withRequestId()` from chapter 9 is such a step. A step
that puts the `requestId` field into the context with an ordinary function
gives the value to readers, but the predicate does not count it: otherwise
the check would come down to matching field names.

The predicates close two different omissions. `hasLayer` answers for a
layer that was forgotten, `hasVar` for a value read from deep in the
graph. They are built the same way: the filter selects endpoints, the
predicate checks the pipeline, and the violations of every policy are
collected into one message.

A policy is an ordinary value, so a plugin can give one out too.
`@nestlingjs/outbox` requires this way that a mutating endpoint be composed
from the transaction layer: the root sets the filter, the plugin names the
variable ([chapter 16](./16-durable-events.md)).

## Excluding from policies, and a hint in the editor

A service endpoint for operations must not write an audit line on every
poll. An endpoint is taken out from under the policies by the `detached`
field:

```typescript
// src/ops.plugin.ts
export const BuildInfo = httpEndpoint.get('/ops/version', {
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: async () => ({ version: process.env.BUILD_VERSION ?? 'dev' }),
});
```

`detached` accepts only a nonempty string with the reason; there is no
`detached: true` form. The reason is visible in the diff, is printed at
start and reaches the `check()` report:

```
[nestling] detached from policies: GET /ops/version (http) — служебный endpoint эксплуатации: …
```

There is no need to write the liveness and readiness probes by hand: the
`httpProbes()` plugin gives them over the `Health$` kernel node, and both
of them are declared with the same `detached` and `doc.hidden` (recipe
["Who is connected right now and how to disconnect
them"](../recipes/ops.md)).

The `doc.hidden` field controls the OpenAPI document, not the build
policies.

The `endpoint-has-layer` rule from `@nestlingjs/eslint-plugin` hints at the
same invariant right in the editor:

```javascript
// eslint.config.js
export default [
  ...createEslintConfig(import.meta.url),
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestlingjs': nestling },
    rules: {
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
```

The rule is syntactic and sees only the text of the declaration, so its
level is `warn`. The guarantee comes from the policy on the built
graph.

## The HTTP form of a handler: a cookie and a redirect

Sign-in issues a session: the response sets a cookie and sends the browser
to the application. `Ok` expresses neither of these — headers and a 3xx
status belong to HTTP. The response form of its own transport sets them:

```typescript
// src/users/endpoints/login.endpoint.ts
@Handler([UsersRepository$])
export class LoginHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(
    input: { email: string },
    meta: HttpHandlerMeta,
  ): HttpOutput<never, typeof UserNotFound> {
    const user = await this.users.byEmail(input.email);
    if (!user) {
      return UserNotFound({ id: input.email });
    }

    const secure = meta.http.headers['x-forwarded-proto'] === 'https';

    return HttpResponse.redirect('/app', {
      cookies: [
        { name: 'sid', value: user.id, path: '/', httpOnly: true, secure },
      ],
    });
  }
}

export const Login = httpEndpoint.post('/login', {
  input: Credentials,
  redirect: 303,
  errors: [UserNotFound],
  detached: 'вход выдаёт сессию, поэтому Bearer-токена у него ещё нет',
  pipeline: observability,
  handler: LoginHandler,
});
```

`meta.http` is the request: the method, the url, the headers and the
socket address. `HttpResponse.of(ok, { headers, cookies })` gives an
ordinary response with headers, `HttpResponse.redirect(location, { status,
cookies })` gives a redirect. Each cookie leaves as a separate `Set-Cookie`
header.

A redirect is declared by the `redirect` field of the declaration. By it
the OpenAPI document shows a 3xx response with the `Location` header, and
the transport takes the status if the call did not set its own. A handler
that returns a redirect on a declaration without this field gets
`internal_error`: the document would have diverged from the behaviour.

The HTTP form is allowed only where the transport declares the address —
in `httpEndpoint`. In `implement` and in `httpEndpoint.implement` such a
class does not pass the types: the implementation of an operation must
stay portable to the bus. A handler without `meta.http` and without
`HttpResponse` fits everywhere.

A handler class declares an interface: `implements Handler<typeof Op>`
takes the types of the input, the result and the failures from the
operation, `implements HttpHandler<typeof Op>` does the same with
`meta.http` and `HttpOutput`. Both names come from one import together
with the role decorator.

## Transport steps

The transport gives the start context `HttpStartContext` to a step that
needs the request:

```typescript
const httpBase = makePipeline<HttpStartContext>()
  .pre(withHeader('x-tenant'))
  .pre(withClientIp())
  .finally(httpAccessLog(logger));
```

`withHeader(name)` puts the value of the header into the context under the
same name; there is no renaming. `withClientIp()` puts the socket address
into the `clientIp` field — behind a proxy this is the address of the
proxy, and the application writes the parsing of `X-Forwarded-For`.
`httpAccessLog(logger)` writes an access line with the method, the path,
the status, the outcome and the byte counters.

Such a pipeline is allowed in an HTTP declaration and does not compile in
`implement`: the slot names the missing fields with an error literal. The
transport does not attach steps of its own — the layer is always visible
in the declaration.

## Check

```typescript
// src/app.spec.ts
it('отклоняет запись без Bearer-токена до вызова хендлера', async () => {
  const repo = inMemoryUsersRepo([alice]);
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, repo]],
  });

  expect(await testApp.call(DeleteUser, { id: '1' })).toMatchObject({
    isSuccess: false,
    status: 'unauthorized',
    value: { code: 'unauthorized' },
  });
  expect(await repo.byId('1')).toEqual(alice);
});

it('создаёт пользователя по Bearer-токену из конфига', async () => {
  await using testApp = await buildTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

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

`testApp.call` without headers gives an `unauthorized` failure, and the
store stays untouched: the handler was not called. Headers in an app test
are passed with the `attributes` option. The value of the Bearer token
comes from `vars({ API_TOKEN: 'test-token' })` in the test options. The
policies in the test build are the same as in `main.ts`: the test
builds the same `app` declaration, not a copy of its dictionary.

```bash
API_TOKEN=secret yarn start:dev
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 401 unauthorized
curl -X POST http://localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 201
```

Files, exports and imports that do not fit in memory:
[chapter 12](./12-files-and-streams.md).
