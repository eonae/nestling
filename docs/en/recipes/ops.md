# Who is connected right now and how to disconnect them

> Guide to the current API; verified against `21794632`.
> Target description: [design/streaming.md](../design/streaming.md), the "4.1
> Subscription registry" section, and
> [design/composition.md](../design/composition.md) §6, the "Kernel nodes:
> probes and logger" section. Rationale: the entries
> [ideas.md](../../decisions/ideas.md)
> `[2026-08-01] Реестр подписок: результат dogfooding-замера` and
> `[2026-09-06] Пробы: HealthCheck$ и Health$ в ядре, транспорты адаптируют`.

The service has an SSE feed from [chapter
17](../guide/17-live-feed.md), and clients keep it open for hours.
Operations needs to see the list of this process's open subscriptions,
close a stuck subscription by its identifier, and watch openings and
closings in real time. The feed's handler must not know who closed it
or why.

The subscription registry lives in a separate package,
`@nestlingjs/subscriptions`. It is written on the kernel's public
primitives and connects as a plugin; the kernel knows nothing about it.

## The plugin in the root

```typescript
// src/app.ts (fragment)
import { everyEndpoint, RequestId } from '@nestlingjs/app';
import { subscriptions } from '@nestlingjs/subscriptions';
// …

export const appSubscriptions = subscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'api-1',
});

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    appObservability,
    appAuth,
    appSubscriptions,
    // …
  ],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(RequestId),
    // …
  ],
  // …
});
```

`subscriptions(options)` returns a plugin. The value is created once
and listed in `plugins:`, like the parametrized plugin from
[chapter 14](../guide/14-features.md). This exact plugin registers the
subscription layer's class units: an endpoint with the `tracked` layer
in an assembly without `appSubscriptions` stops the start at the
ASSEMBLE phase, because an unregistered class unit is not created.

The options describe composition decisions. `identity` names the
subscriber with a context variable: here it is `RequestId` of the
`observability` layer, and in an application with authentication its
place would be taken by a variable holding the user's identifier. The
registry reads the value of the variable by its key and does not know
the shape of the accumulated input.

The pipeline is what puts the variable in, so on an endpoint without it
the entry would appear without `identity` — silently. The
`everyEndpoint({ … }).hasVar(RequestId)` policy catches that: a miss
stops the assembly instead of giving out an empty column in the list of
subscriptions.

The second shape of `identity` is a function of the context. The
accumulated input is out of its reach: a key made of several variables
is assembled by `computed([TenantId, UserId], (_ctx, tenant, user) =>
…)` — it reads the values by the keys of the variables and passes them
to the computation as arguments. The same shape works in `labels`,
which adds labels to the record.

`publish: true` turns on publishing the opening and closing facts as
operations (see below); it is off by default. `node` names the process
in the facts.

## The `tracked` layer on a subscription endpoint

```typescript
// src/features/users/endpoints/activity-stream.endpoint.ts
@Handler([ActivityHub])
class ActivityStreamHandler {
  constructor(private readonly hub: ActivityHub) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription; lastEventId?: string },
  ): Output<AsyncIterable<ActivityEvent>> {
    // A real feed would give back history from this point
    const since = meta.lastEventId ?? '0';

    return new Ok(this.hub.subscribe(meta.subscription.signal, since));
  }
}

export const ActivityStream = httpEndpoint.get('/users/activity', {
  output: events(ActivityEvent),
  sse: {
    id: (event) => event.id,
    event: (event) => event.kind,
  },
  doc: { summary: 'Лента активности (SSE)', tags: ['users'] },
  pipeline: compose(observability, tracked),
  handler: ActivityStreamHandler,
});
```

`tracked` is a pipeline layer from the package. Its `.pre` unit
registers the subscription in the registry before the handler is
called, and its `.finally` unit removes the record when the stream has
closed — regardless of how many items the client managed to read. The
layer is added through `compose`, like any cross-cutting layer from
[chapter 9](../guide/09-logging.md).

The layer puts the `subscription` field into the context with the
record's identifier and signal. The handler listens to
`meta.subscription.signal`, not `meta.signal`. `meta.signal` remains
the request's signal: it fires on the client's disconnect and on the
application's shutdown. `meta.subscription.signal` combines it with
the administrator's signal, so one subscription to it closes the
stream for all three reasons. A handler that listens only to
`meta.signal` keeps giving out data after an administrative close: the
record leaves the registry, but the stream does not.

That the layer stands on every endpoint with a subscription can be
checked by the policy
`everyEndpoint({ pattern: /\/live$/ }).hasLayer(tracked)`, as in
[chapter 10](../guide/10-auth.md). The example has no such policy: the
layer is connected on both `events` endpoints by hand.

## Operational endpoints

The registry is injected by the ordinary DI token
`SubscriptionRegistry`. The endpoints live in the `ops` feature: it has
no providers of its own, and observability, authentication and the
registry arrive as plugins.

```typescript
// src/features/ops/subscriptions.endpoint.ts
@Handler([SubscriptionRegistry])
class ListSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(): Output<Subscription[]> {
    return this.registry.list().map((info) => toWire(info));
  }
}

export const ListSubscriptions = httpEndpoint.get('/ops/subscriptions', {
  output: z.array(Subscription),
  doc: { summary: 'Активные подписки этого узла', tags: ['ops'] },
  pipeline: observability,
  handler: ListSubscriptionsHandler,
});
```

`registry.list()` gives back snapshots of the records: the identifier,
the transport, the pattern, the io shape, the subscriber, the labels,
the start time and the number of items delivered. `toWire` translates
the snapshot into the API's response schema.

```typescript
// src/features/ops/subscriptions.endpoint.ts
@Handler([SubscriptionRegistry])
class KillSubscriptionHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(payload: {
    id: string;
  }): Output<null, typeof SubscriptionNotFound> {
    const killed = this.registry.abort(payload.id, 'administrative kill');

    return killed ? Ok.noContent() : SubscriptionNotFound({ id: payload.id });
  }
}

export const KillSubscription = httpEndpoint.delete('/ops/subscriptions/:id', {
  input: z.object({ id: z.string() }),
  errors: [SubscriptionNotFound],
  doc: { summary: 'Завершить подписку', tags: ['ops'], status: 'no_content' },
  pipeline: authed,
  handler: KillSubscriptionHandler,
});
```

`registry.abort(id, reason)` fires the administrator's signal and
returns `false` if the record does not exist. The record is not
removed from the registry at this point: the `.finally` of the
`tracked` layer removes it when the stream actually closes. The
registry reflects the fact rather than getting ahead of it. The
endpoint stands under the `authed` layer: only someone who presented a
Bearer token can remove someone else's subscription.

```typescript
// src/features/ops/subscriptions.endpoint.ts (fragment)
@Handler([SubscriptionRegistry])
class WatchSubscriptionsHandler {
  constructor(private readonly registry: SubscriptionRegistry) {}

  async handle(
    _payload: unknown,
    meta: { subscription: TrackedSubscription },
  ): Output<AsyncIterable<SubscriptionChange>> {
    const feed = this.registry.watch(meta.subscription.signal);

    return new Ok(
      (async function* () {
        for await (const event of feed) {
          // …
        }
      })(),
    );
  }
}

export const WatchSubscriptions = httpEndpoint.get('/ops/subscriptions/live', {
  output: events(SubscriptionChange),
  sse: {
    id: (change) => change.subscription.id,
    event: (change) => change.type,
  },
  doc: { summary: 'Лента изменений реестра подписок (SSE)', tags: ['ops'] },
  pipeline: compose(observability, tracked),
  handler: WatchSubscriptionsHandler,
});
```

`registry.watch(signal)` gives back an `AsyncIterable` of `opened` and
`closed` events. The feed is itself a subscription: it is composed
from `tracked` and is visible in its own list. It does not receive its
own `opened` event: that event is published before the handler is
called, that is, before the handler has subscribed.

## Opening and closing facts

```typescript
// src/features/ops/subscription-facts.ts (fragment)
@Handler([Logger$.auto])
class SubscriptionOpenedInOpsHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: {
    node?: string;
    id: string;
    transport: string;
    pattern: string;
  }) {
    this.logger.info('subscription opened', {
      node: payload.node ?? 'local',
      id: payload.id,
      transport: payload.transport,
      pattern: payload.pattern,
    });
  }
}

export const SubscriptionOpenedInOps = implement(SubscriptionOpened, {
  subscriber: 'ops',
  handler: SubscriptionOpenedInOpsHandler,
});
// …
```

With `publish: true`, the registry publishes the
`subscriptions.opened` and `subscriptions.closed` events as ordinary
`event`-kind operations from [chapter 15](../guide/15-events.md). The
`ops` feature subscribes to both through `implement` with a subscriber
name; the `SubscriptionClosedInOps` implementation is built the same
way. The registry is local to the process, but the facts go onto the
bus: in a split deployment from [chapter 20](../guide/20-split.md), one
process collects the picture across every node, and the `node` field
tells where the subscription is open. A subscription in another
process cannot be closed through `abort`.

The package pulls in no schema validator and requires no changes to
the kernel: the fact schemas are annotated with `jsonSchema()`, so they
land in the OpenAPI document and in the compatibility snapshot from
[chapter 21](../guide/21-compatibility.md).

## Probes: a plugin in the root, contributions in the modules

Besides the subscription registry, operations needs two probes: the
load balancer asks whether the process is alive, and the orchestrator
asks whether it is ready to accept traffic. Writing them by hand is
not needed: the kernel node `Health$` collects the state of the
application, and the HTTP transport's plugin gives the addresses and
response codes.

```typescript
// src/app.ts (fragment)
import { http, httpProbes } from '@nestlingjs/transport.http';

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [appObservability, appAuth, appSubscriptions, httpProbes(), …],
  transports: [http({ server: api }), …],
});
```

The plugin declares two endpoints — `GET /healthz` and `GET /readyz`.
Both have no pipeline, both are `detached` and `doc.hidden` with a
reason, as in [chapter 10](../guide/10-auth.md): the policy "every HTTP
endpoint has an observability layer" does not fail them, and the
reason is printed at start and appears in the `check()` report. The
plugin declares no providers: the `Health$` node is already in the
graph of every application. The paths change with options —
`httpProbes({ liveness: '/live', readiness: '/ready' })`.

`GET /healthz` answers 200 as long as the process answers at all: it
runs no checks. A stuck event loop does not answer either way, and
restarting the process does not fix a database that has dropped out.

`GET /readyz` answers with a report: the phase, the checks' outcomes,
the result. The result is `ready` only in the RUN phase and only when
every critical check has passed — before RUN and during SHUTDOWN the
result is `not_ready`, and the checks do not run. So after `SIGTERM`
the probe turns red immediately, and the load balancer stops sending
requests into the drain before the first socket closes.

A contribution to the report is an ordinary provider of a
`HealthCheck$` family member, in the module it belongs to (the recipe
[Dependencies by name and contributions collected from
modules](./token-families.md)); a resource needs only the
`health(signal)` method. An application with not a single contribution
assembles, and the list of checks is empty.

There is no separate startup probe: a failure in INIT ends the
process, and nobody is left to tell "still starting" apart from
"crashed".

The `ops` feature remains an operations feature — the subscription
registry and its facts. It has no providers of its own,
`providers: []`. It fits into any topology and is selected explicitly,
as chapter [19](../guide/19-select.md) shows.

## Requests

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev

# in separate terminals: the subscription and the registry feed
curl -N localhost:3000/users/activity
curl -N localhost:3000/ops/subscriptions/live

curl localhost:3000/ops/subscriptions
# [{"id":"d5bd…","transport":"http","pattern":"GET /ops/subscriptions/live","kind":"events",…},
#  {"id":"86cc…","transport":"http","pattern":"GET /users/activity","kind":"events","identity":"43cb…","labels":{"transport":"http"},"startedAt":1788410536706,"itemsOut":0}]

curl -X DELETE localhost:3000/ops/subscriptions/86cc… -H 'authorization: Bearer secret'
# 204

curl localhost:3000/ops/subscriptions
# [{"id":"d5bd…","pattern":"GET /ops/subscriptions/live",…,"itemsOut":2}]

curl -X DELETE localhost:3000/ops/subscriptions/nope -H 'authorization: Bearer secret'
# {"error":"Subscription nope is not active on this node","code":"not_found:subscription","details":{"id":"nope"}}  404

curl localhost:3000/healthz
# {"status":"ok"}

curl localhost:3000/readyz
# {"status":"ready","phase":"RUN","checks":[]}
```

The terminal running `curl -N localhost:3000/users/activity` ends
after the `DELETE`: the stream is closed by the administrator's
signal. The registry's feed received two frames:

```
event: opened
data: {"type":"opened","subscription":{"id":"86cc…","pattern":"GET /users/activity",…,"itemsOut":0}}

event: closed
data: {"type":"closed","reason":"killed","subscription":{"id":"86cc…",…,"itemsOut":1}}
```

The fact subscriber in `ops` wrote the same events to the log:

```
2026-09-06T12:00:00.000Z INFO  SubscriptionOpenedInOpsHandler subscription opened node=api-1 id=86cc… transport=http pattern=GET /users/activity
2026-09-06T12:00:00.001Z INFO  SubscriptionClosedInOpsHandler subscription closed node=api-1 id=86cc… reason=killed itemsOut=1
```

## Checking

```typescript
// src/app.spec.ts
it('показывает подписку, завершает её и удаляет запись', async () => {
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const subscription = streamOf<{ kind: string }>(
    await testApp.call(ActivityStream),
  );

  // The subscription is visible in the list before the first item is
  // delivered
  const [listed] = unwrap(await testApp.call(ListSubscriptions));
  expect(listed).toMatchObject({
    transport: 'http',
    pattern: 'GET /users/activity',
    kind: 'events',
    itemsOut: 0,
  });

  unwrap(await createUser(testApp, 'subscriber'));
  const delivered = await subscription.next();
  expect(delivered.value).toMatchObject({ kind: 'created' });
  expect(unwrap(await testApp.call(ListSubscriptions))[0].itemsOut).toBe(1);

  // The administrator ends the subscription: the stream closes on its
  // own
  const killed = await testApp.call(
    KillSubscription,
    { id: listed.id },
    asClient,
  );
  expect(killed.status).toBe('no_content');

  const tail: unknown[] = [];
  for await (const event of subscription) {
    tail.push(event);
  }
  expect(tail).toEqual([]);

  // The pipeline's `.finally` removed the record when the stream
  // closed
  expect(unwrap(await testApp.call(ListSubscriptions))).toEqual([]);
});
```

An app test runs through the whole scenario with no socket:
`testApp.call` on an `events` endpoint returns an iterator, the list
shows the record before the first item, `KillSubscription` closes the
stream, and the iteration ends on its own. Two other tests of the same
`describe` check the `not_found:subscription` failure and that the
registry's feed does not see its own `opened`.

```bash
yarn test
```

The same primitives without `makeApp`: embedding into someone else's
server and a container without an application — the recipe [Without
`makeApp`](./standalone.md).
