# @nestlingjs/transport.nats

NATS as the application bus: it delivers operation calls between
processes in both directions. `NatsBus` implements `IMessageBus`
outward and `ITransport` inward, so there is no separate «messaging»
entity next to the transports.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/transports.md`](../../docs/en/design/transports.md) §5.
> Guide: [chapter 20. Spread the features across processes](../../docs/en/guide/20-split.md).

## Install

```bash
npm install @nestlingjs/transport.nats nats
```

`nats` is a peer dependency: the client of the version used by the
broker is installed.

## Minimal example

```typescript
import { nats } from '@nestlingjs/transport.nats';

export const app = makeApp({
  features: [OrdersFeature, BillingFeature],
  transports: [http(), nats({ name: 'events' })],
  intercom: 'events',
});

// the declarations, the operations and the call code stay the same when nats() is added
await app.build(load(RootConfig).features).run();
```

## Exports

- **Transport** ([design](../../docs/en/design/transports.md)) —
  `nats`, `NatsBus`, `NatsTransportOptions`, `natsConfigKeys`.
- **Connection** — `NatsConnectionInfo`, `NatsDeliveryFailure`.
- **Connector seam** — `NatsConnector`, `NatsConnectOptions`,
  `NatsLike`. A custom broker client is substituted through the factory
  option; message shapes and JetStream are part of `NatsLike`, and do
  not need to be named for this.
- **Addressing** — `consumerNameOf`, `groupOf`, `streamNameOf`,
  `SUBJECT_HEADER`, `CONTEXT_HEADER`, `IDEMPOTENCY_HEADER`,
  `TIMEOUT_HEADER`, `MSG_ID_HEADER`. The last one is a broker header:
  the stream uses it to recognize a repeated publication.
- **Codec** — `jsonCodec`, `NatsCodec`.
- **Subpath `./testing`** — `natsDouble`, `NatsDouble`,
  `NatsDoubleOptions`, `NatsDoubleError`, `HeadersDouble`,
  `subjectMatches`, `DEFAULT_MAX_DELIVER`, `NATS_CONNECTION_CLOSED`,
  `NATS_NO_RESPONDERS`, `NATS_TIMEOUT`.

The double from `./testing` is substituted through the `connector`
option and replays the delivery in memory: the test sees the same
subjects, headers and repeats. The subpath resolves only under the
`testing` condition: the test runner turns it on by itself, and Node
accepts it with the `--conditions=testing` flag.

## Package boundaries

The package does not start a broker and does not create streams beyond
those the operations need. The codec sets the message format, and
`docs/en/design/transports.md` sets the delivery semantics.

A stream created by the package carries a deduplication window: a
repeat of a durable publication with the same idempotency key inside
the window is removed by the broker itself. The default is 5 minutes,
another value is set by the factory option `dedupeWindowMs`, and `0`
turns off deduplication. The transport does not rewrite a foreign
stream: a window smaller than configured gives a `warn` record, and it
is fixed by the `nats stream edit <name> --dupe-window=5m` command.

The window gives no «exactly once» guarantee: the transport has no
application transaction, so a repeat past the window reaches the
subscriber. [`@nestlingjs/inbox`](../nestling.inbox/) is responsible for
the guarantee.
