# @nestlingjs/otel

Export of the application telemetry over OpenTelemetry. There is one
entry point — `otel(…)` — and it returns two parts: a pipeline layer
that writes the span, and a plugin that sends metrics over OTLP. The
package accumulates nothing of its own: the span is built from the
kernel's `Trace` variable, the metric points from the snapshot of
`MetricsStore$`.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/container.md`](../../docs/en/design/container.md),
> the "Kernel metrics" section, and
> [`docs/en/design/pipeline.md`](../../docs/en/design/pipeline.md) §3.
> Guide chapter: [23. See where the request spent time](../../docs/en/guide/23-tracing.md).

## Install

```bash
npm install @nestlingjs/otel @opentelemetry/api \
  @opentelemetry/sdk-trace-base @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-trace-otlp-http
```

`@opentelemetry/api`, `@opentelemetry/sdk-trace-base` and
`@opentelemetry/sdk-metrics` are peer dependencies: the application creates
the trace exporter and the metric exporter with its own copy of the SDK and
passes them in the `traces` and `metrics` options, so one copy of the SDK
serves both it and the package. The exporter is chosen separately; in the
example below it is OTLP over HTTP.

## Minimal example

```typescript
import { compose, everyEndpoint, makeApp, makePipeline, withTracing } from '@nestlingjs/app';
import { otel, Span } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { http, server } from '@nestlingjs/transport.http';

const api = server();

export const telemetry = otel({
  service: 'orders',
  version: '1.0.0',
  traces: new OTLPTraceExporter(),
});

export const traced = compose(
  makePipeline().pre(withTracing()),
  telemetry.spans,
);

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [telemetry.plugin],
  transports: [http({ server: api })],
  policies: [everyEndpoint().hasVar(Span, 'span')],
});
```

The layer is composed into the application's observability layer, and
the plugin goes into `plugins:`. The policy requires the span variable:
an endpoint that forgets the layer fails the build, instead of silently
dropping out of the trace.

The entry point has five options:

| Option | What it sets |
|---|---|
| `service` | The `service.name` resource attribute; required |
| `version` | The `service.version` resource attribute |
| `traces` | Where the spans go; without it the layer sends nothing |
| `metrics` | Where the metrics go; without it no subscription to the store is made |
| `intervalMs` | The metrics send interval; 60000 by default |

## Exports

- **Entry point** ([design](../../docs/en/design/container.md)) —
  `otel`, `Otel`, `OtelOptions`, `SpansLayer`.
- **Span variable** — `Span`, `OtelSpan`: `Ctx(Span)` reads it, and a
  service adds an attribute or an event to the current span.

## Package boundaries

A span takes its identifiers from the `Trace` variable — the same one
the kernel carries to a neighbor in the `traceparent` header. So the
spans of neighboring processes converge into one tree, instead of
referencing a parent that the export does not have. The span name is
the route pattern from the declaration, the attributes are `transport`,
`pattern` and `outcome`, and the status is derived from the outcome: a
client leaving stays `UNSET`, because that is not a failure of the
service.

The surface of a span is two methods, `setAttribute` and `addEvent`.
There is no closing method exposed: the layer closes the span, and a
second closer would give two spans with one identifier.

The layer requires `trace` in the outer context, so a composition
without `withTracing()` above it does not compile. For an endpoint with
a streaming output the span is sent after the iterator closes: its
duration covers the whole delivery.

The plugin declares a resource that depends on `MetricsStore$`: once
every `intervalMs` it reads `snapshot()` and sends it to the exporter.
Releasing the resource clears the timer, sends the last snapshot and
closes the exporters. The package sets up no SDK instruments: the store
has already computed the aggregate, and the buckets, the `help` and the
`unit` come from the declaration of the metric. So the push and the
exposition of `@nestlingjs/prometheus` show the same thing.

The package wraps no exporters: `SpanExporter` and `PushMetricExporter`
arrive as options, already-built values, so the application picks the
protocol. The values are assembled in the SDK's own shapes —
`ReadableSpan` and `ResourceMetrics` — and any ready exporter works with
no adapter.

The package declares no endpoint of its own, and it has no dependency on
`@nestlingjs/transport.http`. The Prometheus exposition format lives in
its own package.
