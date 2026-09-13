# @nestlingjs/app

The core of Nestling in one package: the request pipeline, configuration,
ports between features, the transport abstraction and the composition
root. `makeApp(spec)` declares the application as a value,
`app.build(select)` builds it for this process, and `run()` builds
the container, finds the endpoints by walking the features and the
plugins, takes the application through the lifecycle phases and stops it
on `SIGTERM` and `SIGINT`.

> 🚧 Active development, the API may change. The package includes no
> schema validator: any [Standard Schema](https://standardschema.dev) fits.
> Design: [`docs/en/design/composition.md`](../../docs/en/design/composition.md),
> [`docs/en/design/pipeline.md`](../../docs/en/design/pipeline.md),
> [`docs/en/design/container.md`](../../docs/en/design/container.md).
> Guide: [chapter 2. Build the application from features](../../docs/en/guide/02-composition.md),
> [chapter 9. See every request in the log](../../docs/en/guide/09-logging.md),
> [chapter 22. Count requests and calls](../../docs/en/guide/22-metrics.md).

## Install

```bash
npm install @nestlingjs/app @nestlingjs/container @nestlingjs/operations
```

The three core packages install together. The transport is chosen
separately: `@nestlingjs/transport.http`, `@nestlingjs/transport.cli`,
`@nestlingjs/transport.nats`.

## Minimal example

```typescript
// app.ts — what the application is
import { makeApp } from '@nestlingjs/app';
import { http } from '@nestlingjs/transport.http';

export const app = makeApp({
  features: [UsersFeature],
  plugins: [appLogging],
  transports: [http()], // an instance declaration, not an instance
});

// main.ts — what starts this process
await app.build().run();
```

## Exports

- **Composition root** ([design](../../docs/en/design/composition.md)) — `App`,
  `BuildArgs`, `BuiltApp`, `Bundle`, `CheckOptions`, `CheckReport`,
  `DiscoveredEndpoint`, `Discovery$`, `EndpointDiscovery`, `Feature`,
  `FeatureOptions`, `isApp`, `makeApp`, `makeFeature`, `makePlugin`, `Plugin`,
  `PluginOptions`, `RunOptions`.
- **Configuration** ([design](../../docs/en/design/config.md)) — `bootstrapConfig`,
  `Config`, `ConfigBinding`, `ConfigDerivedError`, `ConfigField`, `ConfigGlob`,
  `ConfigInput`, `configKernel`, `ConfigKeys`, `ConfigProjection`, `ConfigRecord`,
  `ConfigSectionToken`, `ConfigSharedKeyError`, `ConfigSource`, `ConfigTarget`,
  `ConfigValidationError`, `ConfigValues`, `DerivedConstructor`, `DerivedField`,
  `DerivedRecord`, `DeriveFn`, `describeConfig`, `env`, `from`, `FromField`, `load`,
  `makeConfig`, `objectSource`, `ObjectSource`, `ReloadableConfig`, `secret`,
  `SecretField`, `toBindings`.
- **Pipeline and endpoints** ([design](../../docs/en/design/pipeline.md)) —
  `AnyContextVar`, `AnyEndpointDefinition`, `AnyHandlerResult`,
  `assertLayerFailsDeclared`, `bindInputStream`, `CheckedHandlerFn`,
  `ClientDisconnectedError`, `collectPropagatedContext`, `compose`, `contextKernel`,
  `contextVar`, `ContextVar`, `ContextVarDeclarator`, `ContextVarOptions`,
  `ContextVarUnavailableError`, `Ctx`, `CtxReader`, `DeclaredOutput`,
  `DeclaredOutputSync`, `DeclaredStatuses`, `DeferredPreStepFn`, `done`, `Done`,
  `EndpointDefinition`, `EndpointFilter`, `EndpointMeta`, `EndpointOptions`,
  `ErrorDetails`, `ErrorResponseContext`, `everyEndpoint`, `ExtendableContext`,
  `FinallyStepFn`, `HandlerClass`, `handlerClassOf`, `HandlerFn`, `isAsyncIterable`,
  `isContextVar`, `isDone`, `isEndpointDefinition`, `isMidStreamFailure`,
  `makeEmptyContext`, `makeEndpoint`, `makePipeline`, `MissingFields`, `Outcome`,
  `parseMetadata`, `parsePayload`, `PhasedPipeline`, `Pipeline`, `Policy`,
  `PreStepFn`, `PropagatedContextVar`, `Raw`, `ReadonlyContextVar`, `RequestId`,
  `ResponseContext`, `Signal`, `StepResolver`, `SuccessResponseContext`, `Trace`,
  `TraceContext`, `traceparent`, `TransportClosingError`, `transportNameOf`,
  `UndeclaredDoneError`, `withRequestId`, `withTracing`.
- **Ports and bus** ([design](../../docs/en/design/operations.md)) —
  `BUS_TRANSPORT_NAME`, `BusBinding`, `busBindingOf`, `BusHandler`, `BusMessageMeta`,
  `BusSubscription`, `BusTransport$`, `CompatibilityChange`, `CompatibilityReport`,
  `CompatibilityVerdict`, `Deadline`, `deadlineFromTimeout`, `deadlineIn`,
  `diffOperations`, `failureResponse`, `formatCompatibility`, `Handler`,
  `HandlerMeta`, `IDEMPOTENCY_KEY_ATTRIBUTE`, `IdempotencyKey`, `IMessageBus`,
  `implement`, `InProcessBus`, `isExhausted`, `MessageBus$`, `OperationDescriptor`,
  `OperationSnapshot`, `profileAttributes`, `PublishOptions`, `RequestOptions`,
  `serializeSnapshot`, `SnapshotOperation`, `snapshotOperations`, `startBudget`,
  `SubscribeOptions`, `withIdempotencyKey`.
- **Transport** ([design](../../docs/en/design/transports.md)) — `BusDeclaration`,
  `DEFAULT_INSTANCE`, `Dispatch`, `DispatchOptions`, `ExecutableDeclaration`,
  `IListener`, `ITransport`, `makeDispatch`, `makeServerDeclaration`,
  `makeTransportDeclaration`, `RouteDeclaration`, `ServerDeclaration`,
  `TransportDeclaration`, `transportValue`.
- **Observability and probes** ([design](../../docs/en/design/container.md)) —
  `Health`, `Health$`, `HealthCheck`, `HealthCheck$`, `HealthReport`, `HealthStatus`,
  `LivenessReport`, `logConfigKeys`, `logField`, `LogField`, `LogFieldSpec`,
  `Logger$`, `loggerKernel`, `makeKernelLogger`, `MetricAttributes`, `Metrics`,
  `Metrics$`, `registerHealth`, `RootLogger$`, `RootMetrics$`.
- **Re-export of neighbours** — [`@nestlingjs/operations`](../nestling.operations/)
  (45 names), [`@nestlingjs/logging`](../nestling.logging/) (6) and
  [`@nestlingjs/common.misc`](../common.misc/) (8); the lists are in their README.
- **Subpath `./testing`** — `TestSubstitutions`, `wireApp`, `WiredApp`,
  `WiredEndpoint`, `WireOptions`.

## Package boundaries

The package has no real transport: HTTP, CLI and NATS live in
`@nestlingjs/transport.*`. It has no schema validator either. Ready-made
configuration sources implement the `ConfigSource` interface in separate
packages. Ports do not deduplicate commands by the idempotency key, do not
store snapshots and do not deliver messages outside the process: this
needs a broker transport. Test substitutions live in
[`@nestlingjs/testing`](../nestling.testing/). The `./testing` subpath
resolves only under the `testing` condition: the test runner turns it on
by itself, and Node accepts it with the `--conditions=testing` flag.
