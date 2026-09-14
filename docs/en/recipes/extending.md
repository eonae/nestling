# Extend the kernel with your own package

> Guide to the current API; verified against `2f5689e5`.
> Target description: [design/principles.md](../design/principles.md), the
> "Kernel boundary" section, and [design/streaming.md](../design/streaming.md)
> §4.1. Rationale: the entries [ideas.md](../../decisions/ideas.md)
> `[2026-07-14] «Kernel 1.0» — граница ядра` and
> `[2026-08-01] Реестр подписок: результат dogfooding-замера`.

An application needs a capability that the kernel does not have:
deduplicating commands by an idempotency key, an outbox, a registry of
open subscriptions with administrative closing. Such a package is
written separately, without touching the kernel and without forking
it: it connects to the root as an ordinary plugin, is tested through
`buildTest`, and pulls neither a schema vendor nor storage into the
application.

Such a package is called a satellite: it is built on top of the
kernel's public primitives and lives outside it. The sample in this
recipe is `@nestlingjs/subscriptions`, the subscription registry from
the recipe [Who is connected right now and how to disconnect
them](./ops.md).

## Public primitives

The kernel gives the satellite neither hooks nor extension points.
Everything needed already exists in the public packages:

| Primitive | Package | What the registry uses it for |
|---|---|---|
| `makePlugin` | `@nestlingjs/app` | connecting to the root through `plugins:` |
| `@Handler`, `resourceProvider` | `@nestlingjs/container` | the registry as a graph resource, the layer's class steps |
| `makePipeline`, the `.pre` and `.finally` phases | `@nestlingjs/app` | the `tracked` layer: the record lives as long as the subscription |
| `AbortSignal` | the language standard | the subscription signal, combining three cancellation reasons |
| `Topic` | `@nestlingjs/operations` | the registry's change feed |
| `makeEvent`, `jsonSchema` | `@nestlingjs/operations` | lifecycle facts for other features and processes |

The package's `dependencies` hold only these packages and
`@nestlingjs/common.misc` with the Standard Schema types.
`@nestlingjs/app` is needed only by the tests and sits in
`devDependencies`.

The criterion for the kernel boundary: a satellite is written with no
changes to the kernel. If a capability cannot be expressed with public
primitives, a primitive is missing, and that is what gets fixed, not
the satellite. The subscription registry passed this criterion: there
were no changes to the kernel packages while it was being written.

Two more satellites passed the same measurement, heavier ones:
`@nestlingjs/outbox` and `@nestlingjs/drizzle.pg` from chapters
[11](../guide/11-database.md) and
[16](../guide/16-durable-events.md). They needed no kernel changes
either, but the places they ran into remained: each package keeps them
alive with tests in `core-limits.spec.ts`, and the list with its price
lives in [decisions/ideas.md](../../decisions/ideas.md).

## A layer as an exported value

```typescript
// packages/nestling.subscriptions/src/layer.ts
@Handler([SubscriptionRegistry])
export class TrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(ctx: SubscriptionContext): { subscription: TrackedSubscription } {
    return { subscription: this.registry.open(ctx) };
  }
}

@Handler([SubscriptionRegistry])
export class UntrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(
    outcome: Outcome,
    _res: ResponseContext,
    // The layer's own fields in the response phase are `Partial`:
    // registration might not have happened (an outer pre failed
    // earlier). Then there is nothing to remove
    ctx: { input: { subscription?: TrackedSubscription } },
  ): void {
    const id = ctx.input.subscription?.id;

    if (id !== undefined) {
      this.registry.close(id, outcome);
    }
  }
}

export const tracked = makePipeline()
  .pre(TrackSubscription)
  .finally(UntrackSubscription);
```

The layer consists of two steps in class form: both need the registry
from the container. The pre-step returns the `subscription` field, and
the handler sees it in its types as `meta.subscription`. The
`.finally` step for a streaming `output` runs after the stream has
ended, broken off or been closed by the consumer, so the record is
removed at the exact moment the subscription actually ends. The
registry needs no hook or timer of its own.

The application connects the layer the same way as any of its own:
`compose(traced, tracked)`. The root policy
`everyEndpoint({ … }).hasLayer(tracked)` sets the layer as mandatory,
not a hidden mechanism of the package.

## A field of its own in `meta` and a combined signal

```typescript
// packages/nestling.subscriptions/src/registry.ts (fragment)
  open(ctx: SubscriptionContext): TrackedSubscription {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    // …
    return {
      id,
      // One signal for three cancellation reasons: disconnect,
      // shutdown, kill
      signal: AbortSignal.any([ctx.signal, controller.signal]),
    };
  }
```

The pipeline reserves the `signal` key in `meta`: the request signal
cannot be replaced. So the administrative closing channel lives in a
second field, `meta.subscription.signal`. It combines the request
signal and the record's controller, and the handler gets the client's
disconnect, the application's shutdown and an administrator's closing
through one subscription. The `abort()` method only fires the
controller. `.finally` removes the record when the stream has run dry.

## `Topic` as a change feed

```typescript
// packages/nestling.subscriptions/src/registry.ts (fragment)
    this.#feed = new Topic<SubscriptionEvent>({
      buffer: options.feedBuffer ?? DEFAULT_FEED_BUFFER,
      onSlowConsumer: 'drop-oldest',
    });
  // …
  watch(signal?: AbortSignal): AsyncIterableIterator<SubscriptionEvent> {
    return this.#feed.subscribe(signal);
  }
  // …
  release(): void {
    this.#feed.close();
  }
```

The registry's feed is built the same way as the activity feed in
[chapter 17](../guide/17-live-feed.md): `push` does not wait for
observers, and a slow observer loses events by `drop-oldest`. The
registry is declared a resource (`resourceProvider` in the plugin's
module), so its `release` closes the feed on shutdown, and observers
finish normally.

## Lifecycle facts as operations

```typescript
// packages/nestling.subscriptions/src/operations.ts
/** The value is a zod schema, the declared type is neutral */
const openedSchema: StandardSchemaV1<unknown, SubscriptionOpenedFact> =
  z.object({
    node: z.string().optional(),
    id: z.string(),
    transport: z.string(),
    pattern: z.string(),
    kind: z.enum(KINDS),
    identity: z.string().optional(),
    startedAt: z.number(),
  });

export const SubscriptionOpened = makeEvent({
  name: 'subscriptions.opened',
  input: openedSchema,
  doc: {
    summary: 'Subscription opened',
    description:
      'Published by the subscription registry when a subscription is ' +
      'registered. Observation is cluster-wide: the node name travels in ' +
      'the `node` field.',
  },
});
```

The facts "subscription opened" and "subscription closed" are
published as ordinary `event` operations. A receiver in any feature
and any process writes `implement(SubscriptionOpened, { subscriber:
'…' })`, as in the `ops` feature from the recipe [Who is connected
right now and how to disconnect them](./ops.md).

The fact schemas are written in the same validator as the rest of the
framework's schemas, so the usual converter translates them into JSON
Schema with no annotation, and the facts land in the document and in the
compatibility snapshot from [chapter 21](../guide/21-compatibility.md).
This imposes no vendor on the application: the type of the operation is
declared as the neutral `StandardSchemaV1<unknown, T>`, and a subscriber
writes its own schemas in whatever it likes.

## A parametrized plugin

```typescript
// packages/nestling.subscriptions/src/module.ts
export const subscriptions = (options: SubscriptionsOptions = {}): Plugin => {
  const deps: readonly InjectionToken[] = options.publish
    ? [SubscriptionOpened.emitter, SubscriptionClosed.emitter]
    : [];

  // The registry is a resource: it holds the feed, which must be
  // closed on SHUTDOWN. A functional form, not a class under
  // `@Resource`: the dependency list here depends on a composition
  // decision (`publish`), and the decorator is static
  const registry: ResourceProviderDefinition<SubscriptionRegistry> = {
    provide: SubscriptionRegistry,
    deps,
    acquire: (
      opened?: Emitter<typeof SubscriptionOpened>,
      closed?: Emitter<typeof SubscriptionClosed>,
    ) => new SubscriptionRegistry(options, opened, closed),
    release: (value: SubscriptionRegistry) => value.release(),
  };

  return makePlugin({
    name: '@nestlingjs/subscriptions',
    providers: [registry, TrackSubscription, UntrackSubscription],
  });
};
```

The satellite's plugin is built the same way as the logging plugin
from [chapter 14](../guide/14-features.md): the function accepts
composition decisions and returns a `makePlugin` value. The plugin
itself registers the layer's class steps, so an endpoint with the
`tracked` layer and no `makeSubscriptions()` in the root stops the
build at the BUILD phase: the layer's class step gets no
dependencies. A second `makeSubscriptions({ … })` value in the same root
also stops the build: two plugins with one name. The resource's
`deps` list depends on the `publish` option: with publishing turned
off, there are no operation callers in the graph.

## Test doubles through the `./testing` subpath

```json
// packages/nestling.transport.nats/package.json (fragment)
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "testing": {
        "types": "./dist/testing/index.d.ts",
        "import": "./dist/testing/index.js"
      }
    }
  },
```

If a satellite ships test doubles, like `NatsDouble` from [chapter
20](../guide/20-split.md), put them in the `./testing` subpath under
the `"testing"` export condition. In a production build, the condition
is not turned on, and importing `@nestlingjs/transport.nats/testing`
does not resolve at the Node level. The runner turns the condition on
itself:

```javascript
// jest
testEnvironmentOptions: { customExportConditions: ['testing', 'node', 'node-addons'] }
```

A package that imports such a subpath needs `customConditions:
['testing']` in `tsconfig.json`.

## A transport of your own

```typescript
// packages/nestling.subscriptions/src/__fixtures__/transport.ts
export const TestTransport$: Token<ITransport> =
  makeToken<ITransport>('transport:test');

export class TestTransport implements ITransport {
  // …
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export const testTransport = (): TransportDeclaration =>
  transportValue(TestTransport$, new TestTransport(), {
    capabilities: STREAMING,
  });
```

The transport implements the `ITransport` interface from
`@nestlingjs/app`: `serve(dispatch, signal)` receives the routing
table and the shared stop signal, `close()` releases resources. The
interface has no start method without routes.

Not the instance but the **declaration** declares the io forms a
transport can carry: the `capabilities` field of `TransportDeclaration`.
This way, the form check happens at the BUILD phase, where
instances do not exist yet. A declaration whose io form is not among
the transport's capabilities is rejected before the first request is
served. The transport is referenced by the instance's DI token, and
the declaration for the `transports:` dictionary comes from
`transportValue(token, instance, { capabilities })`. The real
transports `http()`, `cli()` and `nats()` are built on the same
interface and put their own capability constant into the declaration.

## Checking

A satellite is tested with the same test root as the application. The
package's test builds the plugin, one feature and a transport
fixture:

```typescript
// packages/nestling.subscriptions/src/module.spec.ts (fragment)
  it('видит подписку, убивает её и снимает запись', async () => {
    await using testApp = await buildTest(
      makeApp({
        plugins: [makeSubscriptions()],
        features: [makeFeature({ name: 'module:ticks', endpoints: [Ticks] })],
        transports: [testTransport()],
      }),
    );

    const registry = testApp.get(SubscriptionRegistry);
    // …
    const response = await testApp.call(Ticks);
    expect(response.isSuccess).toBe(true);

    const [info] = registry.list();
    expect(info).toMatchObject({
      transport: 'test',
      pattern: 'ticks:watch',
      kind: 'events',
    });

    const items: Tick[] = [];
    for await (const tick of streamOf<Tick>(response)) {
      items.push(tick);
      if (items.length === 2) {
        expect(registry.abort(info.id, 'админ закрыл подписку')).toBe(true);
      }
    }

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(registry.size).toBe(0);
  });
```

The `Ticks` endpoint in the test is declared through `makeEndpoint` on
the fixture transport: the package needs no HTTP, and the transport's
capabilities are declared by value. The second test in the same file
checks the shutdown: after `testApp.close()`, the stream runs dry,
`.finally` removes the record, and the feed's observer finishes
normally.

```bash
yarn workspace @nestlingjs/subscriptions test
```

Connecting it in the application:

```typescript
// src/app.ts (fragment)
export const subscriptions = makeSubscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'api-1',
});
```

A context variable names the subscriber: the registry reads its value by
the key and does not know the shape of the accumulated input — neither
in types nor at runtime.

The recipe [Who is connected right now and how to disconnect
them](./ops.md) shows how operations use this.

This is the last recipe of the list. The target description of every
subsystem lives in [design/](../design/README.md), the reasons for
decisions in [decisions/ideas.md](../../decisions/ideas.md).
Alternative forms that the chapters showed once each are collected in
[appendix A](./alternatives.md). The correspondences with NestJS
concepts are in [appendix B](../from-nestjs.md).
