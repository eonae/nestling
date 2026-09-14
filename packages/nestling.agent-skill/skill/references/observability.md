# Observability

How an application reports on itself: records, numbers and spans. Logging
and metrics are primitives of the kernel and need no package beyond
`@nestlingjs/app`; carrying them outside is what a satellite does. Names
live in the READMEs of
[`@nestlingjs/app`](https://www.npmjs.com/package/@nestlingjs/app) and
[`@nestlingjs/logging`](https://www.npmjs.com/package/@nestlingjs/logging).

## Logging

The root sets the logger with one option, `makeApp({ logging: { logger,
fields } })`. Without `logger` the standard one writes to `stderr`.

`fields` lists the context variables whose values the kernel mixes into
every record inside a request. The default is
`[RequestId, logField(Trace, 'traceId', (trace) => trace.traceId)]`, so any
implementation gets `requestId` and `traceId` without knowing anything
about the kernel. `logField(Var, name, select?)` names the field and picks
the part of the value that belongs in it; a variable without the wrapper
gives a field named after itself. A plugin declares its own with
`logFields`, and two fields with one name stop the build.

`Logger$.auto` is the token to depend on: the logger arrives already named
after the class that asked for it. `logger.child({ orderId })` binds fields
for a stretch of work. Four levels — `debug`, `info`, `warn`, `error` —
and the section `nestlingLog` also takes `silent`, which is what a test
run uses by default.

Records go through pino with `logging: { logger: pinoLogger() }` from
`@nestlingjs/logging.pino`. The `text` format matches the standard logger
byte for byte; `json` is written by pino with the same keys.

## Metrics are declarations

A metric is declared, not invented at run time. There is no
`metrics.counter('some.name')`: a name that no declaration carries cannot
be written.

<!-- snippet: users.metrics.ts#declare -->
```typescript
export const UsersMetrics = makeMetrics('users', {
  registered: counter({
    help: 'Registered users',
    attributes: { tier: ['free', 'paid'], source: open },
  }),
  'signup.duration': histogram({
    help: 'Time to register',
    unit: 'ms',
    buckets: [5, 25, 100, 500, 1000],
  }),
});
```

The group is a DI token, and the writer it provides is typed by the
declaration:

<!-- snippet: users.metrics.ts#write -->
```typescript
@Component([UsersMetrics])
export class SignupCounter {
  constructor(private readonly metrics: MetricsOf<typeof UsersMetrics>) {}

  record(elapsed: number): void {
    this.metrics.registered.add({ tier: 'paid', source: 'web' });
    this.metrics['signup.duration'].record(elapsed);
  }
}
```

The group is contributed by `metrics:` of a feature, a module, a plugin or
the root — `makeFeature({ name: 'users', metrics: [UsersMetrics], … })`.
The catalogue is assembled on the BUILD phase, and two groups whose names
collide stop it.

What is accumulated belongs to the kernel. `MetricsStore$` is a node of the
graph that is always there, with a single output, `snapshot()`. Four
metrics of the kernel are declared by the same mechanism, so the
instrumentation is always on. A test reads the snapshot:
`testApp.metrics.counter(UsersMetrics.members.registered, { tier: 'paid' })`;
a unit test of a class without a container takes the writer from
`metricsFor`.

`makePrometheus({ path })` from `@nestlingjs/prometheus` goes into
`plugins:` and serves `GET /metrics` on the socket of the application. The
endpoint is `detached` and stays out of the API document. A histogram comes
out as `_bucket`, `_sum` and `_count` with the buckets from the
declaration.

## Spans

`@nestlingjs/otel` carries traces and metrics out over OpenTelemetry.
`otel({ service, version, traces, metrics, intervalMs })` returns two
parts: the pipeline layer `spans` and the plugin `plugin`.

The layer opens a span with a `.pre` step and closes it with a `.finally`
step, taking the status from the outcome. The identifiers come from the
context variable `Trace` that `withTracing()` puts there, which is why the
spans of neighbouring processes join into one tree — and why the layer does
not compile without `withTracing()` above it in the composition. Compose it
next to the rest: `compose(makePipeline().pre(withRequestId()).pre(
withTracing()), telemetry.spans)`.

The policy `everyEndpoint().hasVar(Span, 'span')` turns a forgotten layer
into a build failure. A service reads the span with `Ctx(Span)` and puts
attributes and events on it.

With the `metrics` option the plugin reads `MetricsStore$.snapshot()` every
`intervalMs` — 60 000 by default — and sends it to a `PushMetricExporter`;
the last snapshot leaves on shutdown, and a failing exporter does not break
it. Buckets, `help` and `unit` come from the declaration, so the push and
the Prometheus exposition show the same thing. Exporters are the
application's own choice: the package carries the SDK, not the
`exporter-*` packages.
