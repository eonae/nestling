# @nestlingjs/app

Ядро Nestling одним пакетом: пайплайн обработки запроса, конфигурация, порты
между фичами, абстракция транспорта и композиционный корень. `makeApp(spec)`
объявляет приложение значением, `app.build(select)` собирает его для этого
процесса, а `run()` строит контейнер, находит endpoint'ы обходом фич и
плагинов, проводит приложение по фазам жизненного цикла и останавливает его
по `SIGTERM` и `SIGINT`.

> 🚧 Активная разработка, API может меняться. Валидатор схем в пакет не
> входит: подходит любая [Standard Schema](https://standardschema.dev).
> Дизайн: [`docs/design/composition.md`](../../docs/design/composition.md),
> [`docs/design/pipeline.md`](../../docs/design/pipeline.md),
> [`docs/design/container.md`](../../docs/design/container.md).
> Гайд: [глава 2. Собрать приложение из фич](../../docs/guide/02-composition.md),
> [глава 9. Видеть каждый запрос в логе](../../docs/guide/09-logging.md),
> [глава 22. Считать запросы и вызовы](../../docs/guide/22-metrics.md).

## Установка

```bash
npm install @nestlingjs/app @nestlingjs/container @nestlingjs/operations
```

Три пакета ядра ставятся вместе. Транспорт выбирается отдельно:
`@nestlingjs/transport.http`, `@nestlingjs/transport.cli`,
`@nestlingjs/transport.nats`.

## Минимальный пример

```typescript
// app.ts — чем приложение является
import { makeApp } from '@nestlingjs/app';
import { http } from '@nestlingjs/transport.http';

export const app = makeApp({
  features: [UsersFeature],
  plugins: [appLogging],
  transports: [http()], // объявление экземпляра, а не экземпляр
});

// main.ts — что запускает этот процесс
await app.build().run();
```

## Экспорты

- **Композиционный корень** ([design](../../docs/design/composition.md)) —
  `App`, `BuildArgs`, `BuiltApp`, `Bundle`, `CheckOptions`,
  `CheckReport`, `DiscoveredEndpoint`, `Discovery$`, `EndpointDiscovery`,
  `Feature`, `FeatureOptions`, `isApp`, `makeApp`, `makeFeature`, `makePlugin`,
  `Plugin`, `PluginOptions`, `RunOptions`.
- **Конфигурация** ([design](../../docs/design/config.md)) — `bootstrapConfig`,
  `Config`, `ConfigBinding`, `ConfigDerivedError`, `ConfigField`, `ConfigGlob`,
  `ConfigInput`, `configKernel`, `ConfigKeys`, `ConfigProjection`,
  `ConfigRecord`, `ConfigSectionToken`, `ConfigSharedKeyError`, `ConfigSource`,
  `ConfigTarget`, `ConfigValidationError`, `ConfigValues`,
  `DerivedConstructor`, `DerivedField`, `DerivedRecord`, `DeriveFn`,
  `describeConfig`, `env`, `from`, `FromField`, `load`, `makeConfig`,
  `objectSource`, `ObjectSource`, `ReloadableConfig`, `secret`, `SecretField`,
  `toBindings`.
- **Пайплайн и endpoint'ы** ([design](../../docs/design/pipeline.md)) —
  `AnyContextVar`, `AnyEndpointDefinition`, `AnyHandlerResult`,
  `assertLayerFailsDeclared`, `bindInputStream`, `CheckedHandlerFn`,
  `ClientDisconnectedError`, `collectPropagatedContext`, `compose`,
  `contextKernel`, `contextVar`, `ContextVar`, `ContextVarDeclarator`,
  `ContextVarOptions`, `ContextVarUnavailableError`, `Ctx`, `CtxReader`,
  `DeferredPreStepFn`, `done`, `Done`, `EndpointDefinition`, `EndpointFilter`,
  `EndpointMeta`, `EndpointOptions`, `ErrorDetails`, `ErrorResponseContext`,
  `everyEndpoint`, `ExtendableContext`, `FinallyStepFn`, `HandlerClass`,
  `handlerClassOf`, `HandlerFn`, `isAsyncIterable`, `isContextVar`, `isDone`,
  `isEndpointDefinition`, `isMidStreamFailure`, `makeEmptyContext`,
  `makeEndpoint`, `makePipeline`, `MissingFields`, `Outcome`, `parseMetadata`,
  `parsePayload`, `PhasedPipeline`, `Pipeline`, `Policy`, `PreStepFn`,
  `PropagatedContextVar`, `Raw`, `ReadonlyContextVar`, `RequestId`,
  `ResponseContext`, `Signal`, `SuccessResponseContext`, `Trace`,
  `TraceContext`, `traceparent`, `TransportClosingError`, `transportNameOf`,
  `UndeclaredDoneError`, `StepResolver`, `withRequestId`, `withTracing`.
- **Порты и шина** ([design](../../docs/design/operations.md)) —
  `BUS_TRANSPORT_NAME`, `BusBinding`, `busBindingOf`, `BusHandler`,
  `BusMessageMeta`, `BusSubscription`, `BusTransport$`, `CompatibilityChange`,
  `CompatibilityReport`, `CompatibilityVerdict`, `Deadline`,
  `deadlineFromTimeout`, `deadlineIn`, `diffOperations`, `failureResponse`,
  `formatCompatibility`, `Handler`, `HandlerMeta`, `IDEMPOTENCY_KEY_ATTRIBUTE`,
  `IdempotencyKey`, `IMessageBus`, `implement`, `InProcessBus`, `isExhausted`,
  `MessageBus$`, `OperationDescriptor`, `OperationSnapshot`,
  `profileAttributes`, `PublishOptions`, `RequestOptions`, `serializeSnapshot`,
  `SnapshotOperation`, `snapshotOperations`, `startBudget`, `SubscribeOptions`,
  `withIdempotencyKey`.
- **Транспорт** ([design](../../docs/design/transports.md)) — `BusDeclaration`,
  `DEFAULT_INSTANCE`, `Dispatch`, `DispatchOptions`, `ExecutableDeclaration`,
  `IListener`, `ITransport`, `makeDispatch`, `makeServerDeclaration`,
  `makeTransportDeclaration`, `RouteDeclaration`, `ServerDeclaration`,
  `TransportDeclaration`, `transportValue`.
- **Наблюдаемость и пробы** ([design](../../docs/design/container.md)) —
  `Health`, `Health$`, `HealthCheck`, `HealthCheck$`, `HealthReport`,
  `HealthStatus`, `logConfigKeys`, `logField`, `LogField`, `LogFieldSpec`,
  `Logger$`, `loggerKernel`, `makeKernelLogger`, `MetricAttributes`,
  `Metrics`, `Metrics$`, `registerHealth`, `RootLogger$`, `RootMetrics$`.
- **Реэкспорт соседей** — [`@nestlingjs/operations`](../nestling.operations/)
  (45 имён), [`@nestlingjs/logging`](../nestling.logging/) (6 имён) и
  [`@nestlingjs/common.misc`](../common.misc/) (8 имён); перечни в их README.
- **Подпуть `./testing`** — `TestSubstitutions`, `wireApp`, `WiredApp`,
  `WiredEndpoint`, `WireOptions`.

## Границы пакета

Реального транспорта в пакете нет: HTTP, CLI и NATS живут в
`@nestlingjs/transport.*`. Валидатора схем в нём тоже нет. Готовые источники
конфигурации реализуют интерфейс `ConfigSource` отдельными пакетами. Порты не
дедуплицируют команды по ключу идемпотентности, не хранят снапшоты и не
доставляют сообщения за пределы процесса: для этого нужен транспорт брокера.
Тестовые подстановки живут в [`@nestlingjs/testing`](../nestling.testing/).
Подпуть `./testing` резолвится только под условием `testing` — тест-раннер
включает его сам, Node принимает флагом `--conditions=testing`.
