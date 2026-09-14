# 23. See where the request spent time

> Guide to the current API; verified against `61c0a878`.
> Target description: [design/pipeline.md](../design/pipeline.md) §3,
> the "Standard observability steps" section, and
> [design/container.md](../design/container.md), the "Kernel metrics"
> section. Why: entry [ideas.md](../../decisions/ideas.md)
> `Разбор обзоров d/10 и d/13` [2026-09-12], item 2.

The numbers from [chapter 22](./22-metrics.md) show that there are more
requests now and the service answers slower. Beyond that they say
nothing: a counter does not show which exact step took that half
second — the work of the handler, a database query or a call to a
neighboring process. Spans are needed: every request has its own start,
its own end and its own place in a tree.

The kernel already carries the trace. `withTracing()` from
[chapter 9](./09-logging.md) puts the `Trace` variable into the context
with the fields `traceId`, `spanId` and `parentSpanId`, the
`traceparent` header carries them to the neighbor, and the logger writes
`traceId` into every record. The interval — when a span started and how
long it ran — nobody records, and there is nothing to show the trace in
Jaeger.

## The satellite hands out a layer and a plugin

Telemetry export lives in the package `@nestlingjs/otel`. There is one
entry point:

```typescript
// src/observability.ts
import { otel } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export const telemetry = otel({
  service: 'orders',
  version: '1.0.0',
  traces: new OTLPTraceExporter(),
});
```

`service` and `version` become the resource attributes `service.name`
and `service.version` — by them the backend tells the traces of one
service apart from the traces of another. The exporter arrives as a
ready value: the package does not choose the protocol, only what to
send. `OTLPTraceExporter` takes the address of the collector from the
environment variable `OTEL_EXPORTER_OTLP_ENDPOINT`.

The value `telemetry` carries two parts. `telemetry.spans` is the
pipeline layer that writes the span. `telemetry.plugin` is the plugin:
it closes the exporter when the application stops and sends metrics if
the `metrics` option is set ([chapter 22](./22-metrics.md)).

## The span layer composes into the observability layer

A span is written by pipeline steps: the pre-step opens it, the
`.finally` step closes it with the outcome. The layer is added to the
one that already puts `requestId` and the trace there:

```typescript
// src/observability.ts
import { compose, makePipeline, withRequestId, withTracing } from '@nestlingjs/app';

export const traced = compose(
  makePipeline().pre(withRequestId()).pre(withTracing()).finally(AuditOutcome),
  telemetry.spans,
);
```

The order is mandatory, and the compiler checks it: the layer requires
`trace` in the outer context. The composition without `withTracing()`
above does not compile — the diagnostic names the missing field.

```typescript
// does not compile: there is no `trace` in the outer context
compose(makePipeline().pre(withRequestId()), telemetry.spans);
```

The layer intentionally holds no `withTracing()` of its own. The
application declares the continuation of the trace — in one step and in
one place, otherwise a request would end up with two different
`spanId`s.

## A build policy requires the variable

A layer forgotten on one endpoint does not fail: that route disappears
from the trace. To turn a forgotten layer into a build failure, a
policy is declared:

```typescript
// src/app.ts
import { everyEndpoint, makeApp } from '@nestlingjs/app';
import { Span } from '@nestlingjs/otel';

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [telemetry.plugin],
  transports: [http({ server: api })],
  policies: [everyEndpoint().hasVar(Span, 'span')],
});
```

`hasVar` credits the declaration of the variable by the layer, so
recomposing the layer does not break the policy — unlike `hasLayer`,
which compares the value by reference ([chapter 10](./10-auth.md)). The
failure arrives at the BUILD phase and names the pattern of the
endpoint and the module that declared it; the socket does not open.

An endpoint that does not need a span is marked `detached` with a
reason — like with any other policy.

## What goes into a span

The name of a span is the route pattern from the declaration:
`GET /orders/:id`, not `GET /orders/42`. The addresses of specific
requests do not go into the names, so the number of distinct names in
the backend is finite.

A span has the same three attributes as the kernel metrics: `transport`,
`pattern` and `outcome`. The status of a span is derived from the
outcome:

| Outcome | Span status |
|---|---|
| `completed` | `OK` |
| `failed` | `ERROR` |
| `aborted` | `ERROR` |
| `disconnected` | `UNSET` |

`disconnected` is intentionally not painted `ERROR`: a client that
closed the connection is not a failure of the service, and the error
rate on a dashboard should not grow from client behavior. Such spans
can be picked out by the `outcome` attribute.

For an endpoint with a streaming output (`stream`, `events` from
[chapter 12](./12-files-and-streams.md)) the `.finally` step is called
after the iterator closes. The duration of the span covers the whole
delivery, not the work of the handler.

The identifiers of a span are taken from the `Trace` variable, not
created anew. So a span of a neighboring process refers, as its parent,
to the span that carried the `traceparent` to it, and the tree
converges.

## The service adds an attribute

A span lies in the request context as the `Span` variable. A class
reads it through `Ctx(Span)` and sets its own attributes and events:

```typescript
// src/features/orders/orders.service.ts
import type { CtxReader } from '@nestlingjs/app';
import { Ctx } from '@nestlingjs/app';
import type { OtelSpan } from '@nestlingjs/otel';
import { Span } from '@nestlingjs/otel';
import { Component } from '@nestlingjs/container';

@Component([Ctx(Span)])
export class OrdersService {
  constructor(private readonly span: CtxReader<OtelSpan>) {}

  async checkout(id: string) {
    this.span.peek()?.setAttribute('order.id', id);
    this.span.peek()?.addEvent('payment requested');

    return this.payments.charge(id);
  }
}
```

Reading goes through `peek()`: outside a request there is no span, and
the reader returns `undefined`. The value has two methods —
`setAttribute` and `addEvent`. There is no closing method: the layer
closes the span, and a second closer would give two spans with one
identifier.

The service, meanwhile, knows nothing about the OpenTelemetry SDK: it
sees a context variable, like `Ctx(RequestId)` or `Ctx(TenantId)`.

## The tree of two processes

The features spread across processes from [chapter 20](./20-split.md)
each write spans with their own satellite. The layer is put into the
base layer of both processes:

```typescript
// src/base.ts
export const traced = compose(
  makePipeline().pre(withTracing()).pre(TenantId.propagated()),
  telemetry.spans,
);
```

The caller puts the trace into the envelope of the message, the
receiver returns it with the `withTracing()` step on its own side. The
span of the receiver sees the identifier of the caller's span in
`Trace.parentSpanId` and becomes its child. A port call has no span of
its own: the time spent on the network and in the broker queue is shown
by the difference between the metrics `nestling.port.duration` and
`nestling.request.duration`.

## Look at the tree

The collector and the tree viewer come up in one container:

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
```

The application starts with the address of the collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 yarn start:dev
```

The tree opens at `http://localhost:16686`: the service is picked by
`service.name`, the request by the `traceId` from the log record.

Without the environment variable the exporter sends nowhere, and
without the `traces` option the layer works and sends nothing. The
composition of the application does not change because of that: export
is turned on by a deployment setting.

## The check

The test substitutes an exporter that accumulates spans in memory, and
reads them after the request:

```typescript
// src/features/orders/tracing.spec.ts
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

const traces = new InMemorySpanExporter();
const telemetry = otel({ service: 'orders', traces });

await using testApp = await buildTest(app);

await testApp.call(GetOrder, { id: '42' });

const [span] = traces.getFinishedSpans();

expect(span?.name).toBe('GET /orders/:id');
expect(span?.attributes.outcome).toBe('completed');
```

A span arrives at the exporter as a value of the shape `ReadableSpan` —
the same one it would get from the OpenTelemetry SDK. So in a test any
ready-made exporter works, and in production, the one that knows the
protocol of the deployment.
