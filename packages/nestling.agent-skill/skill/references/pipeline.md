# Pipeline

A pipeline is what runs around a handler. It is built from units by
`makePipeline()` and it is a value: an endpoint references it through
`pipeline:`, several endpoints share the same one, and a policy compares
layers by identity. Names live in the README of
[`@nestlingjs/app`](https://www.npmjs.com/package/@nestlingjs/app).

## Phases of a unit

| Method | Runs | Gets | May |
|---|---|---|---|
| `.pre(unit)` | before the handler | the context | add typed fields, or return a failure |
| `.ok(unit)` | after a successful handler | the value and the context | replace the value |
| `.catch(unit)` | after a failure | the failure and the context | replace it with another failure |
| `.finally(unit)` | on every outcome | the outcome, the response, the context | observe only |

There is no `next()` and there is no wrapping. A `.pre` unit that returns a
failure ends the request: no later unit and no handler runs. A `.catch`
unit can only exchange one failure for another — it cannot turn a failure
into a success.

A unit is a function when it needs nothing from the container, and a class
marked `@Handler([…])` when it does. A unit class is a provider like any
other: register it, usually in the plugin that owns the layer.

<!-- snippet: pipeline.ts -->
```typescript
import { AppConfig } from './app.config.js';
import { Unauthorized } from './errors.js';

import type {
  Config,
  EmptyInput,
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  compose,
  Logger$,
  makePipeline,
  makePlugin,
  withRequestId,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * A `.pre` unit runs before the handler and adds typed fields to the
 * context. There is no `next()`: units do not wrap each other.
 */
@Handler([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(
    ctx: ExtendableContext<EmptyInput>,
  ): { caller: { id: string } } | ReturnType<typeof Unauthorized> {
    const header = ctx.raw.attributes.authorization;

    // Returning a failure stops the request: no later unit, no handler
    return header === `Bearer ${this.config.apiToken}`
      ? { caller: { id: 'api-token' } }
      : Unauthorized();
  }
}

/** A `.finally` unit runs on every outcome, success and failure alike */
@Handler([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

/** A layer is a value: endpoints reference it, policies compare it by identity */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);

/** `compose` stacks layers; the failure declared here joins `errors:` */
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);

/** Unit classes are providers: without registration the layer does not build */
export const appPipeline = makePlugin({
  name: 'app-pipeline',
  providers: [Authenticate, AuditOutcome],
});
```

## Layers

`compose(a, b)` stacks layers: the `.pre` units of `a` run before those of
`b`, and the response-side units run in reverse. Failures declared next to
a unit — `makePipeline().pre(Authenticate, { errors: [Unauthorized] })` —
join the failure set of every endpoint that takes the layer, and appear in
its OpenAPI document without being repeated in `errors:`.

Layers are the reason `pipeline:` takes a value rather than a list of
decorators: the same object is compared later by a policy.

## Context

The context carries the raw request (`ctx.raw`), the fields that `.pre`
units added, and the context variables of the request. A variable is read
from anywhere in the graph with `Ctx(Var)`, so a provider deep inside can
see the request id without any parameter being passed down. `withRequestId()`
is the built-in unit that puts one there; `contextVar` declares your own.

## Policies

A policy is an invariant over the assembled graph. It is declared in
`makeApp({ policies })`, checked at the end of ASSEMBLE and before INIT,
and it fails the process instead of failing a request.

<!-- snippet: app.ts -->
```typescript
import { appPipeline, authed, observability } from './pipeline.js';
import { QuotasFeature, UsersFeature } from './users.feature.js';

import { everyEndpoint, makeApp } from '@nestlingjs/app';
import { http, HttpTransport$ } from '@nestlingjs/transport.http';

/**
 * The application declaration: one value for `main.ts`, for tests and for
 * the topology check. Policies are invariants over the assembled graph and
 * are checked before INIT, so a missing layer stops the process instead of
 * showing up on some request in production.
 */
export const app = makeApp({
  features: [UsersFeature, QuotasFeature],
  plugins: [appPipeline],
  transports: [http()],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
  ],
});
```

`everyEndpoint(filter)` selects endpoints by transport and by pattern.
`.hasLayer(layer, name)` requires the layer, `.hasVar(Var, name)` requires
a context variable to be set by the time the handler runs. Use a policy for
anything that a reviewer would otherwise have to remember for every new
endpoint — authentication, audit, tracing.
