# @nestlingjs/prometheus

Exposition of the application metrics in the Prometheus format. The
plugin reads the snapshot of the kernel store and serves the text at
`GET /metrics`: the kernel holds what is accumulated, the package adds
the format.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/container.md`](../../docs/en/design/container.md),
> the "Kernel metrics" section.
> Guide chapter: [22. Count requests and calls between processes](../../docs/en/guide/22-metrics.md).

## Install

```bash
npm install @nestlingjs/prometheus
```

## Minimal example

```typescript
import { makeApp } from '@nestlingjs/app';
import { prometheus } from '@nestlingjs/prometheus';
import { http, server } from '@nestlingjs/transport.http';

const api = server();

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [prometheus()],
  transports: [http({ server: api })],
});
```

There is nothing else to configure: the kernel metrics and the
application metrics are already in `MetricsStore$`, and the plugin
serializes them. The address of the exposition is changed by the option
`prometheus({ path: '/internal/metrics' })`.

## Exports

- **Plugin** ([design](../../docs/en/design/container.md)) — `prometheus`,
  `PrometheusOptions`.
- **Format** — `serialize`: a snapshot of the store as the exposition
  text. The plugin uses it, and so does whoever serves the metrics
  another way.

## Package boundaries

The package keeps no counters of its own: a second accumulation next to
the kernel would diverge from it at the first entry. It starts no HTTP
server of its own either — the exposition lives on the socket of the
application.

The endpoint is marked `detached` and hidden from the API document:
metrics are scraped by the collector, not by a client. So the build
policies do not check it, and its path is not in the OpenAPI document.

A series with the value zero is printed along with the rest: the
composition of series is known to the build, and a dashboard with zero
errors is distinguishable from a dashboard with no data. The dots of the
name become underscores, the unit goes into the series name, and the
labels follow a stable order — the `le` of a bucket last. The bucket
boundaries come from the declaration of the metric, so the package
computes nothing.

The package has no dependency on OpenTelemetry: this is one exposition
format, not a telemetry model. A push export is built on
`MetricsStore$.tap(sink)` and lives in its own package.
