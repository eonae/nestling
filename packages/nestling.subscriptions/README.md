# @nestlingjs/subscriptions

The registry of active subscriptions: the list, the forced closing of
one or several, the feed of changes. The package is written entirely
on public primitives of the kernel — a plugin, a pipeline layer and a
singleton in the container — so the kernel does not know about it.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/streaming.md`](../../docs/en/design/streaming.md) §4.1.
> Guide: [recipe "Who is connected right now and how to disconnect them"](../../docs/en/recipes/ops.md).

## Install

```bash
npm install @nestlingjs/subscriptions
```

## Minimal example

```typescript
import { subscriptions, SubscriptionRegistry, tracked } from '@nestlingjs/subscriptions';

// 1. The plugin: created once in the composition root
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { userId?: string }).userId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true, // lifecycle facts as operations
  node: process.env.HOSTNAME,
});

// 2. The layer: added to the endpoint's pipeline, like any cross-cutting behaviour
export const Feed = httpEndpoint.get('/api/feed', {
  output: events(Event),
  pipeline: compose(basePipeline, tracked),
  handler: FeedHandler, // receives meta.subscription with the shared signal
});

// 3. The registry is injected by an ordinary DI token: registry.list(), registry.kill()
```

## Exports

- **Connection** — `subscriptions`, `SubscriptionsOptions`, `tracked`,
  `TrackSubscription`, `UntrackSubscription`.
- **Registry** — `SubscriptionRegistry`, `SubscriptionInfo`,
  `SubscriptionFilter`, `SubscriptionKind`, `TrackedSubscription`,
  `SubscriptionKilledError`, `CloseReason`.
- **Lifecycle facts** ([design](../../docs/en/design/operations.md)) —
  `SubscriptionOpened`, `SubscriptionClosed`, `SubscriptionOpenedFact`,
  `SubscriptionClosedFact`, `SubscriptionEvent`.

The facts are published as operations only if the plugin has
`publish: true` set.

## Package boundaries

The registry knows the subscriptions of its own process. It has no
shared state between replicas: the list from a neighbouring process is
collected by an operation call.
