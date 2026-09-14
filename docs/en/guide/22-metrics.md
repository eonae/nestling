# 22. Count requests and calls between processes

> Guide to the current API; verified against `bfacfec4`.
> Target description: [design/container.md](../design/container.md), the
> "Kernel metrics" section, [design/pipeline.md](../design/pipeline.md) §2
> and [design/operations.md](../design/operations.md) §2.3. Why: entry
> [ideas.md](../../decisions/ideas.md) `Метрика — декларация`
> [2026-09-14].

The two processes from [chapter 20](./20-split.md) work, and the log
records are linked by the trace. The log shows what happened to one
request, but not how many there were and how long they took. Numbers are
needed: a counter of requests, the duration of processing and the same
for the calls of operations between processes.

## A metric is declared as a value

A metrics group is a value created by `makeMetrics`. The prefix of the
group and the key of the entry add up to the metric name:
`orders.created`, `orders.checkout.duration`. There are no other names.

```typescript
// src/features/orders/orders.metrics.ts
import { counter, histogram, makeMetrics, open } from '@nestlingjs/app';

export const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'], source: open },
  }),

  'checkout.duration': histogram({
    help: 'Checkout duration',
    unit: 'ms',
    buckets: [5, 25, 100, 500, 1000],
  }),
});
```

There are two constructors, one per kind. A counter has no buckets, a
histogram has no default increment — the compiler checks the difference
at the point of declaration, not a condition at runtime.

The key is written the way it should read in the name:
`'checkout.duration'` is an ordinary object key in quotes. There is no
`camelCase`-to-dots conversion.

## An attribute is declared by a list of values or by `open`

Every attribute of a metric is declared, and the declaration has no
default. A list of values gives two consequences: a value outside the
list does not compile, and the series of the metric are known as the
product of the lists — before the first request.

`open` declares an attribute whose values are known only at runtime: the
series is created by the first entry, and it has no zeros. The mark is
the place where the author of the metric signs for keeping the number of
series under control.

## The graph hands out the writer

The group serves both as the declaration and as a DI token:
`@Component([OrdersMetrics])` gives a writer where a metric is picked as
a field.

```typescript
// src/features/orders/orders.service.ts
import type { MetricsOf } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

import { OrdersMetrics } from './orders.metrics.js';

@Component([OrdersMetrics])
export class OrdersService {
  constructor(private readonly metrics: MetricsOf<typeof OrdersMetrics>) {}

  create(): void {
    this.metrics.created.add({ tier: 'paid', source: 'web' });
    this.metrics['checkout.duration'].record(42);
  }
}
```

A counter has the method `add(value?, attributes?)`, a histogram has
`record(value, attributes?)`. `add` without a value adds one. Declared
attributes are required: without them the series is not defined. Both
methods are synchronous and return `void` — writing a metric has no right
to delay the request.

An undeclared entry is not expressible: there is no string name at the
point of writing, and neither an extra attribute key nor a value outside
the list compiles.

One consequence to know upfront: code outside the graph cannot write a
metric. A free function takes the writer as a parameter from whoever
declared the dependency.

## A group is contributed with `metrics:`

The field `metrics:` belongs to a feature, a module, a plugin and the
root — next to `endpoints:` and `providers:`:

```typescript
// src/features/orders/orders.feature.ts
export const OrdersFeature = makeFeature({
  name: 'orders',
  metrics: [OrdersMetrics],
  providers: [OrdersService],
  endpoints: [CreateOrder],
});
```

A group requested as a dependency but not contributed is a build
failure, and its text names the `metrics:` field. The groups of an
unselected feature and of an unselected switch branch do not reach the
build — by the same mechanism that removes their providers.

From the contributions of the selected composition the BUILD phase
collects the catalog: the name, the kind, the description, the unit, the
buckets and the attributes of every metric. The catalog is ready before
the INIT phase, so the list of metrics of the process is known before the
socket opens. Two groups with one full metric name fail the build — the
text of the failure names both.

## The four metrics the kernel counts

The kernel declares its own metrics with the same group — `KernelMetrics`
with the prefix `nestling` — and counts request handling and port
invocation itself, without a single step in the pipeline:

| Metric | Kind | Attributes |
|---|---|---|
| `nestling.requests` | counter | `transport`, `pattern`, `outcome` |
| `nestling.request.duration` | histogram, ms | `transport`, `pattern`, `outcome` |
| `nestling.port.calls` | counter | `operation`, `kind`, `binding`, `outcome` |
| `nestling.port.duration` | histogram, ms | `operation`, `kind`, `binding`, `outcome` |

`outcome` takes the same four values a `.finally` step sees:
`completed`, `disconnected`, `aborted`, `failed`. `pattern` is the route
template from the declaration, not the address of the request: for
`GET /users/:id` the attribute is one for all identifiers.

The values of `transport`, `pattern` and `operation` come from the
declarations of the build, so the series of the kernel metrics are
created before the first request. The exposition of a freshly started
process shows zeros for every endpoint and every outcome — and a
dashboard with zero errors is distinguishable from a dashboard with no
data.

`binding` takes `local` and `remote` and answers whether the call went to
the broker or stayed in the process. A call of an operation implemented
here goes through `dispatch` and therefore gives two groups of entries:
its own with `binding: 'local'` and the `nestling.requests` entry of the
endpoint of the implementation.

For an endpoint with a streaming output the duration measures the whole
delivery: the response phase of a stream is deferred until the iterator
closes, and the entry follows it.

The instrumentation is always on and has no flag: writing a declared
series is an increment by an index computed at build time.

## The kernel holds what is accumulated

`MetricsStore$` is a graph node that every application has. It holds the
values of the series and the catalog they were created from:

```typescript
interface MetricsStore {
  readonly catalog: MetricsCatalog;
  snapshot(): MetricsSnapshot;
}
```

`snapshot()` returns the state of all series at the moment of the call:
the metric name, the attributes of the series, the counter value or the
histogram aggregate, plus the description and the unit from the
declaration. The snapshot is a copy: entries made after the call do not
change it.

There is one output. A receiver that sends the numbers out over its own
protocol takes the state on a timer: both the Prometheus exposition and
the OTLP push accept accumulated values, not increments.

There is nothing to configure in the store, and it has no root option:
an export plugin is a consumer, not a switch.

## The exposition arrives as a package

The kernel knows no export format. The text for the Prometheus scraper
comes from a separate package:

```typescript
// src/app.ts
import { makePrometheus } from '@nestlingjs/prometheus';

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [makePrometheus()],
  transports: [http({ server: api })],
});
```

The plugin reads `MetricsStore$` and serves the exposition at
`GET /metrics`; the address is changed by the option
`makePrometheus({ path: '/internal/metrics' })`. The package starts no server
of its own — the exposition lives on the socket of the application. The
endpoint is marked `detached` and hidden from the API document: metrics
are scraped by the collector, not by a client.

A histogram is written as `_bucket` series, a `_sum` and a `_count`. The
bucket boundaries come from the declaration of the metric, so the
exporter does not compute them.

## A push over OTLP is a second reader of the same store

A deployment that gathers telemetry with an OpenTelemetry collector,
not by scraping, sends the numbers itself. The satellite plugin
`@nestlingjs/otel` does this:

```typescript
// src/app.ts
import { otel } from '@nestlingjs/otel';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

export const telemetry = otel({
  service: 'orders',
  metrics: new OTLPMetricExporter(),
  intervalMs: 60_000,
});

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [telemetry.plugin, makePrometheus()],
  transports: [http({ server: api })],
});
```

The plugin reads `snapshot()` once every `intervalMs` and sends it to
the exporter; when the application stops, the last snapshot goes out,
so the entries of the last interval are not lost. The satellite keeps
no instruments of its own: the store has already computed the
aggregate, and the buckets, `help` and `unit` come from the declaration
of the metric. So the push and the exposition show the same thing.

There can be two plugins, as above: they read one store and know
nothing about each other. The same satellite hands out the spans of the
trace as a layer — [chapter 23](./23-tracing.md).

## The check

The test reads the snapshot of the test application and addresses a
series by a member of the group:

```typescript
// src/features/orders/orders.spec.ts
await using testApp = await buildTest(app);

await testApp.call(CreateOrder, { sku: 'x' });

expect(
  testApp.metrics.counter(OrdersMetrics.members.created, { tier: 'paid' }),
).toBe(1);

expect(
  testApp.metrics.counter(KernelMetrics.members.requests, {
    outcome: 'completed',
  }),
).toBe(1);
```

`counter(...)` sums the matching series, `histogram(...)` returns the
aggregate of one series, `snapshot()` returns the whole snapshot. No root
substitution is needed: the entries of the application and the entries of
the kernel are in one store.

A unit test of a class without the container takes the writer from
`metricsFor`:

```typescript
const orders = metricsFor(OrdersMetrics);
const service = new OrdersService(orders.metrics);

service.create();

expect(
  orders.read.counter(OrdersMetrics.members.created, { tier: 'paid' }),
).toBe(1);
```
