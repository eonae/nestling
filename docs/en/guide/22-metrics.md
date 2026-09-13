# 22. Count requests and calls between processes

> Guide to the current API; verified against `c05b4909`.
> Target description: [design/container.md](../design/container.md), the
> "Kernel metrics" section, [design/pipeline.md](../design/pipeline.md) §2
> and [design/operations.md](../design/operations.md) §2.3. Why: entry
> [ideas.md](../../decisions/ideas.md) `Разбор обзоров d/10 и d/13`
> [2026-09-12], point 2.

The two processes from [chapter 20](./20-split.md) work, and the log
records are linked by the trace. The log shows what happened to one
request, but not how many there were and how long they took. Numbers are
needed: a counter of requests, the duration of processing and the same
for the calls of operations between processes.

## The metrics interface

`Metrics` is the interface through which both the kernel and the
application write. There are two methods:

```typescript
type MetricAttributes = Record<string, string | number | boolean>;

interface Metrics {
  counter(name: string, value?: number, attributes?: MetricAttributes): void;
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
}
```

`counter` increases the counter, and `counter` without a value increases
it by one. `histogram` adds an observation: a duration, a body size, a
count of elements. Both methods are synchronous and return `void`:
writing a metric has no right to delay the request.

The interface has no instrument object. The kernel names a metric, and
the implementation decides how to store it.

## The implementation arrives as a root option

While the implementation is not set, the records go nowhere: an empty
implementation stands under the root DI token `RootMetrics$`. A service
writes a metric and assembles without any configuration — like a logger
that writes to `stderr` until a library is connected.

The `metrics` option of the root sets the implementation:

```typescript
// src/app.ts
export function declareApp(options: DeclareOptions = {}): App {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [metricsPlugin(exporter)],
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
  });
}
```

The value is ready-made, like the `logger` option. There is no second way
to set the root: a provider under `RootMetrics$` in `providers:` is an
assembly error, and its text names the `metrics` option.

The option also turns on the instrumentation of the kernel. Without it,
the runtime does not measure time and does not call the write methods at
all, so an application that does not need metrics does not pay for them.

## Four metrics that the kernel counts

The kernel counts the processing of a request and the call of a port
itself, without a single unit in the pipeline:

| Metric | Kind | Attributes |
|---|---|---|
| `nestling.requests` | counter | `transport`, `pattern`, `outcome` |
| `nestling.request.duration` | histogram, ms | `transport`, `pattern`, `outcome` |
| `nestling.port.calls` | counter | `operation`, `kind`, `binding`, `outcome` |
| `nestling.port.duration` | histogram, ms | `operation`, `kind`, `binding`, `outcome` |

`outcome` takes the same four values that a `.finally` unit sees:
`completed`, `disconnected`, `aborted`, `failed`. `pattern` is the route
template from the declaration, not the address of the request: for
`GET /users/:id` the attribute is one for every identifier. This way the
row count at the exporter stays finite and does not grow with traffic.

`binding` takes `local` and `remote` and answers whether the call went
out to the broker or stayed in the process. A call to an operation
implemented right here goes through `dispatch` and so gives two groups of
records: its own with `binding: 'local'` and the `nestling.requests`
record of the implementation's endpoint. Counting requests, the
`binding` attribute separates them.

For an endpoint with a streaming output, the duration measures the
delivery as a whole: the response phase of the stream is deferred until
the iterator closes, and the record follows it.

## Records of the application

Metrics reach a service as an ordinary dependency — as a member of the
`Metrics$` family:

```typescript
@Component([Metrics$.auto])
export class OrdersService {
  constructor(private readonly metrics: Metrics) {}

  create(): void {
    this.metrics.counter('orders.created');
  }
}
```

`Metrics$.auto` gives a member by the name of the class, and the
attribute `scope: 'OrdersService'` is added to every record. A different
scope name needs `Metrics$('orders')`.

## The adapter and the `/metrics` endpoint

The kernel does not know where the numbers go: it has no export format.
The application writes the adapter itself — it is what checks that the
public boundary of the kernel is enough.

```typescript
// src/metrics.ts
export interface MetricsExporter extends Metrics {
  render(): string;
}

export function prometheusExporter(): MetricsExporter {
  const counters = new Map<string, number>();
  const histograms = new Map<string, { count: number; sum: number }>();

  return {
    counter: (name, value = 1, attributes = {}) => {
      const key = keyOf(name, attributes);

      counters.set(key, (counters.get(key) ?? 0) + value);
    },
    // histogram and render are in the same place
  };
}
```

The adapter goes to two places at once: as the `metrics` option it
becomes the root, and as a provider of the plugin it becomes the node of
the graph that the `/metrics` endpoint reads.

```typescript
// src/metrics.ts (fragment)
export function metricsPlugin(exporter: MetricsExporter): Plugin {
  @Handler([MetricsExporter$])
  class MetricsHandler {
    constructor(private readonly exporter: MetricsExporter) {}

    async handle() {
      return new Ok(this.exporter.render());
    }
  }

  return makePlugin({
    name: 'metrics',
    providers: [valueProvider(MetricsExporter$, exporter)],
    endpoints: [
      httpEndpoint.get('/metrics', {
        output: 'text',
        detached: 'metrics scrape: not part of the application API',
        handler: MetricsHandler,
      }),
    ],
  });
}
```

A plugin, not a feature: metrics are needed in every process of the
deployment, and the feature selection does not concern them. `detached`
takes the endpoint out from under the assembly policies: the metrics are
scraped by the collector, not by an API client.

The histogram is expressed by the pair `_count` and `_sum`: the kernel
does not set buckets. A real exporter needs buckets, and it sets them up
on its own — the interface of the kernel does not stand in the way.

## Checking

```typescript
// src/metrics.spec.ts
it('обработка операции попадает в экспорт счётчиком и длительностью', async () => {
  const exporter = prometheusExporter();
  const plugin = metricsPlugin(exporter);

  const observed = makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [plugin],
    transports: [http()],
    metrics: exporter,
  });

  await using testApp = await assembleTest(observed, { args: 'all' });

  await testApp.emit(RegisterUser, { email: 'alice@example.com' });

  const text = exporter.render();

  expect(text).toContain('nestling_requests{');
  expect(text).toMatch(/nestling_port_calls\{[^}]*binding="local"/);
});
```

For a test that needs the records, not the text, `@nestlingjs/testing`
gives `spyMetrics()`:

```typescript
const spy = spyMetrics();
await using testApp = await assembleTest(app, {
  overrides: [[RootMetrics$, spy.metrics]],
});

await testApp.call(GetUser, { id: '1' });

expect(spy.records).toContainEqual(
  expect.objectContaining({ name: 'nestling.requests' }),
);
```

Substituting the root does two things at once: it intercepts the records
of every member of `Metrics$` and turns on the instrumentation of the
kernel, because an empty implementation no longer stands under the root.
