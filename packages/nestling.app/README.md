# @nestlingjs/app

Ядро Nestling одним пакетом: пайплайн обработки запроса, конфигурация, порты
между фичами, абстракция транспорта и композиционный корень. `makeApp(spec)`
объявляет приложение значением, `app.assemble(select)` собирает его для этого
процесса, а `run()` строит контейнер, находит endpoint'ы обходом фич и
плагинов, проводит приложение по фазам жизненного цикла и останавливает его
по `SIGTERM` и `SIGINT`.

> 🚧 Активная разработка, API может меняться. Валидатор схем в пакет не
> входит: подходит любая [Standard Schema](https://standardschema.dev).
> Дизайн: [`docs/design/composition.md`](../../docs/design/composition.md),
> [`docs/design/pipeline.md`](../../docs/design/pipeline.md).
> Гайд: [глава 2. Собрать приложение из фич](../../docs/guide/02-composition.md),
> [глава 7. Конфигурация секциями](../../docs/guide/07-config.md).

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
await app.assemble().run();
```

## Экспорты

- **Композиционный корень** ([design](../../docs/design/composition.md)) —
  `App`, `AssembleArgs`, `AssembledApp`, `Bundle`, `CheckOptions`,
  `CheckReport`, `DiscoveredEndpoint`, `Discovery$`, `EndpointDiscovery`,
  `Feature`, `FeatureOptions`, `isApp`, `makeApp`, `makeFeature`, `makePlugin`,
  `Plugin`, `PluginOptions`.
- **Конфигурация** ([design](../../docs/design/config.md)) — `bootstrapConfig`,
  `Config`, `ConfigBinding`, `ConfigDerivedError`, `ConfigField`, `ConfigGlob`,
  `ConfigInput`, `configKernel`, `ConfigKeys`, `ConfigProjection`,
  `ConfigRecord`, `ConfigSectionToken`, `ConfigSharedKeyError`, `ConfigSource`,
  `ConfigTarget`, `ConfigValidationError`, `ConfigValues`, `DerivedConstructor`,
  `DerivedField`, `DerivedRecord`, `DeriveFn`, `describeConfig`, `env`, `from`,
  `FromField`, `load`, `makeConfig`, `objectSource`, `ObjectSource`,
  `ReloadableConfig`, `secret`, `SecretField`, `toBindings`.
- **Пайплайн и endpoint'ы** ([design](../../docs/design/pipeline.md)) —
  `AnyContextVar`, `AnyEndpointDefinition`, `assertLayerFailsDeclared`,
  `bindInputStream`, `ClientDisconnectedError`, `collectPropagatedContext`,
  `compose`, `contextKernel`, `contextVar`, `ContextVar`,
  `ContextVarDeclarator`, `ContextVarOptions`, `ContextVarUnavailableError`,
  `Ctx`, `CtxReader`, `DeferredPreUnitFn`, `EndpointDefinition`, `EndpointFilter`, `EndpointMeta`,
  `EndpointOptions`, `ErrorDetails`, `ErrorResponseContext`, `everyEndpoint`,
  `ExtendableContext`, `FinallyUnitFn`, `HandlerClass`, `handlerClassOf`,
  `HandlerFn`, `isAsyncIterable`, `isEndpointDefinition`, `isMidStreamFailure`,
  `makeEmptyContext`, `makeEndpoint`, `makePipeline`, `MissingFields`,
  `Outcome`, `parseMetadata`, `parsePayload`, `PhasedPipeline`, `Pipeline`,
  `Policy`, `PreUnitFn`, `PropagatedContextVar`, `Raw`, `ReadonlyContextVar`,
  `RequestId`, `ResponseContext`, `Signal`, `SuccessResponseContext`,
  `TransportClosingError`, `transportNameOf`, `UnitResolver`, `withIdentity`,
  `withPermissions`, `withRequestId`.
- **Порты и шина** ([design](../../docs/design/operations.md)) —
  `BUS_TRANSPORT_NAME`, `BusBinding`, `busBindingOf`, `BusHandler`,
  `BusMessageMeta`, `BusSubscription`, `BusTransport$`, `CompatibilityChange`,
  `CompatibilityReport`, `CompatibilityVerdict`, `Deadline`,
  `deadlineFromTimeout`, `deadlineIn`, `diffOperations`, `failureResponse`,
  `formatCompatibility`, `Handler`, `HandlerMeta`, `IdempotencyKey`,
  `IMessageBus`, `implement`, `InProcessBus`, `isExhausted`, `MessageBus$`,
  `OperationDescriptor`, `OperationSnapshot`, `profileAttributes`,
  `PublishOptions`, `RequestOptions`, `serializeSnapshot`, `SnapshotOperation`,
  `snapshotOperations`, `startBudget`, `SubscribeOptions`, `withIdempotencyKey`.
- **Транспорт** ([design](../../docs/design/transports.md)) — `BusDeclaration`,
  `DEFAULT_INSTANCE`, `Dispatch`, `DispatchOptions`, `ExecutableDeclaration`,
  `IListener`, `ITransport`, `makeDispatch`, `makeServerDeclaration`,
  `makeTransportDeclaration`, `RouteDeclaration`, `ServerDeclaration`,
  `TransportDeclaration`, `TransportEntry`, `transportValue`.
- **Пробы** — `Health`, `Health$`, `HealthCheck`, `HealthCheck$`,
  `HealthReport`, `HealthStatus`, `registerHealth`.
- **Логгер** — `Fields`, `Logger`, `Logger$`, `loggerKernel`, `LogLevel`,
  `makeKernelLogger`, `RootLogger$`.
- **Реэкспорт [`@nestlingjs/operations`](../nestling.operations/)** — операции,
  отказы и формы io: 45 имён, перечень в README пакета-соседа.
- **Реэкспорт [`@nestlingjs/common.misc`](../common.misc/)** — схемный кернел: 8 имён,
  перечень в README пакета-соседа.
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
