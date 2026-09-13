# Alternative shapes

> Guide to the current API; verified against `21794632`.
> Each form is shown in one place in the example.

The chapters of the guide use one notation for each task. The
framework allows other forms too. Here they are collected in one
place: where an alternative is shown and when to choose it.

| Task | Default form | Alternative | Shown in |
|---|---|---|---|
| Failure from a handler | `return Fail` | `throw Fail` from deep in the call stack | `user-webhook.endpoint.ts` |
| Failure from a pre-unit | `return Fail` declared on the layer | `throw Fail` from deep in the call stack | `plugins/auth/authenticate.ts` |
| Reacting to an error | `.finally` with `outcome` | `.catch` with `.is()` | `features/users/endpoints/delete-user.endpoint.ts` |
| Replacing a successful response | the handler builds the response | an `.ok` unit | not in the example |
| Success without a body | a bare value | `Ok.noContent()`, `Ok.accepted()` | `delete-user.endpoint.ts` |
| Feature composition | `providers:` | `modules:` | `features/users/users.feature.ts` |
| Feature selection | the object `{ features, includeDeps }` | a comma-separated string | `packages/nestling.app/README.md` |

## Failure from a unit

```typescript
// src/plugins/auth/authenticate.ts
    if (token === undefined || token !== this.config.apiToken) {
      return Unauthorized();
    }
// connecting the unit declares its failures
makePipeline().pre(Authenticate, { errors: [Unauthorized] });
```

The canon is `return`, like a handler's. The failure is declared as
the second argument of `.pre`, and the compiler checks the return
against this list. The runtime recognizes the failure before it writes
the result into the context, so it never reaches the accumulated
`input`. [Chapter 10](../guide/10-auth.md) explains how this works.

| Form | The compiler sees | Where it's declared |
|---|---|---|
| `return Fail` from a pre-unit | yes | the second argument of `.pre` |
| `throw Fail` from a pre-unit | no | `.pre` or the endpoint's `errors:` |
| `throw Fail` from deep in the call stack | no | the endpoint's or the operation's `errors:` |

`throw` remains for delivery from deep within the call stack: a
service with no return channel to the boundary throws the failure, and
the handler does not catch it. For the response, a return and a throw
are indistinguishable: the runtime stops the pipeline; the handler is
not called; the response phase receives this `Fail`. The compiler does
not see a throw, so such a failure must be declared: the runtime
replaces an undeclared one with `InternalError` (500).

## A `.catch` layer with a check by code

```typescript
// src/features/users/endpoints/delete-user.endpoint.ts
@Handler([Logger$.auto])
export class AuditDeletion {
  constructor(private readonly logger: Logger) {}

  handle(res: ErrorResponseContext): void {
    if (UserNotFound.is(res.value)) {
      this.logger.info('delete refused', { reason: res.value.message });
    }
  }
}

// …
  pipeline: compose(authed, makePipeline().catch(AuditDeletion)),
```

A `.catch` unit is called only for an error response. It receives the
response context, not the `Fail` itself, so the failure is recognized
through `.is()`. A unit that returns nothing leaves the response
unchanged. Returning a different `Fail` is possible; turning an error
into a success is not.

Choose `.catch` when the reaction is needed only for errors and
depends on the failure code. For auditing every outcome, use
`.finally` from [chapter 9](../guide/09-logging.md).

## The `.ok` unit

The example has no `.ok` unit. Per the README of `@nestlingjs/app`, it
is called only for a successful response and sees the full context:
success means that every `.pre` unit has run. The unit may return a
different successful response, for example to add a header, or return
nothing and leave the response as is. Turning a success into an error
through `.ok` is not possible. The `errors:` check runs after `.ok`
and `.catch`, before `.finally`.

Choose `.ok` when a header or a response transformation is needed by
several endpoints and should not repeat in every handler.

## `Ok.noContent()` and `Ok.accepted()`

```typescript
// src/features/users/endpoints/delete-user.endpoint.ts
    return removed ? Ok.noContent() : UserNotFound({ id: input.id });
```

A bare value from the handler answers `200`. `Ok.created(value)`
answers `201`, `Ok.noContent()` answers `204` with no body,
`Ok.accepted(value)` answers `202`. `Ok` carries no headers: the HTTP
response form `HttpResponse.of(value, { headers })` sets them. The
success status for the OpenAPI document is named in `doc.status`
(`'ok'`, `'created'`, `'accepted'`, `'no_content'`), as for
`DeleteUser`. The second argument of `Ok` holds the response headers;
they don't depend on the transport, and the transport decides what to
do with them.

## `providers:` and `modules:` on a feature

```typescript
// src/features/notifications/notifications.feature.ts
export const NotificationsFeature = makeFeature({
  name: 'notifications',
  providers: [Suppressions, Suppressions],
  endpoints: [CheckAddressImpl, WelcomeEmail, ForgetAddressImpl],
});
```

```typescript
// src/features/users/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    // …
  ],
});
```

A feature lists its providers directly or groups them into
`makeModule` modules. A module groups providers under a name and can
declare `dependsOn`. While there are few providers, `providers:` is
shorter. When a feature grows and its providers split into groups that
need each other, switch to `modules:`. The feature lists the endpoints
in both cases.

## Feature selection by string

The `app.assemble(select)` argument accepts four forms: `'all'`, a
comma-separated string `'users,ops'`, an array `['users', 'ops']` and
the object `{ features, includeDeps }`. The example reads a string
from `APP_FEATURES` and wraps it in an object for `includeDeps`, as
[chapter 19](../guide/19-select.md) shows. A string without the object
fits when closure over the calls is not needed: every needed feature
is named explicitly.
