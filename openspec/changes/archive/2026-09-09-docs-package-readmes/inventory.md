# Инвентарь: что было в README крупных пакетов и куда уехало

Снято на задачах 5.1 и 5.9. Пять README занимали 4582 строки из 6277.

## Абзацы по корзинам

Каждый раздел старого README отнесён к одной из трёх корзин D7: копия
существующего текста, семантика без копии, шаг обучения без копии.

| Пакет | Разделы старого README | Корзина | Куда |
|---|---|---|---|
| `app` | «Композиционный корень», «Пайплайн», «Конфигурация», «Порты и операции», «Транспорт» | копия | удалены; текст в `design/composition.md`, `pipeline.md`, `config.md`, `operations.md`, `transports.md` |
| `app` | «Логгер ядра», «Пробы» | копия | удалены; текст в `design/composition.md` §6 |
| `container` | «Основные понятия», «Полный пример», «Справочник API» | копия | удалены; текст в `design/container.md` и главах 17 и 22 |
| `container` | «Отличия от NestJS» | копия | удалён; текст в `guide/appendix-b-from-nestjs.md` |
| `operations` | «Операция», «Результат», «Отказы», «Формы io», «HTTP-адрес», «Потоки» | копия | удалены; текст в `design/operations.md`, `errors.md`, `endpoints.md`, `streaming.md` |
| `operations` | «Две копии пакета» | семантика | перенесена в `design/operations.md` §1.5 |
| `operations` | «Кто читает пакет» | копия | удалён; состав зависимостей виден по README пакетов-потребителей |
| `testing` | девять разделов по именам API | копия | удалены; текст в `design/testing.md` и главах 8 и 16 |
| `transport.http` | «Декларация endpoint'а», «Юниты транспорта», «Размещение полей входа», «Потоки», «Сервер», «Пробы» | копия | удалены; текст в `design/transports.md` §4 и `endpoints.md` |
| `transport.http` | «Безопасность и лимиты», абзац про `closeTimeout` и keep-alive | семантика | перенесён в `design/transports.md` §4.2 |
| `transport.http` | «Безопасность и лимиты», абзац про таблицу статусов | семантика | перенесён в `design/transports.md` §4.1 как `httpCodeOf` |

Шагов обучения без копии в пяти README не нашлось: `guide/` покрывает все
сценарии, которые они описывали. Поэтому главы не дописывались, и даты в
плашках «сверено с кодом» не двигались.

## Расхождения README с кодом

Сверка перечней с барелями нашла одно расхождение: `packages/nestling.viz`
объявлял вход `.` на `./dist/index.js`, которого пакет не собирает. Поля
`main`, `types` и `exports` из его `package.json` убраны: пакет ставится ради
команды `nestling-viz`.

## Имена, которым не нашлось читателя

Читателем считается импорт вне `src` пакета либо упоминание в `docs/design`
или `docs/guide`. Имена без читателя убраны из публичных барелей
`@nestling/app` и `@nestling/operations` этим же change'ом: без этого перечень
экспортов в README не укладывался ни в один разумный бюджет.

### `@nestling/app`: убрано 114 своих имён

  `AnyAddition`, `AnyEndpointHandler`, `AnyPipeline`, `AppPhase`, `AppSpec`,
  `AssembleObject`, `BUS_CAPABILITIES`, `BundleComposition`,
  `BundleOptionsBase`, `CallBudget`, `CatchUnitFn`, `CheckedEndpoint`,
  `ConfigDerivedDescription`, `ConfigDescribeOptions`, `ConfigDescription`,
  `ConfigFieldFailure`, `ConfigKeyDescription`, `ConfigKeyReader`,
  `ConfigReader`, `ConfigSectionDescription`, `ConfigSharedKeyDescription`,
  `ConfigSourceError`, `DependencyResolver`, `DescribeOptions`,
  `DescribeSource`, `DiscoveredDeclaration`, `DispatchPolicy`,
  `EndpointPolicyBuilder`, `EnvSourceOptions`, `ExecuteOptions`,
  `FailDescriptor`, `FileFieldDescriptor`, `FormDescriptorValue`,
  `HealthCheckResult`, `HealthKernelOptions`, `ImplementDictionary`,
  `InProcessBusOptions`, `InitialContext`, `InputSources`, `JsonValue`,
  `LivenessReport`, `LogFormat`, `LogMethod`, `MakeDispatchOptions`,
  `MidStreamFailure`, `ModuleOwner`, `NormalizedAppSpec`,
  `NormalizedSelection`, `OkUnitFn`, `OperationCompatibility`,
  `OperationImplementation`, `OperationReport`, `OperationSlot`,
  `OperationTopology`, `OperationTopologyEntry`, `OwnerMap`,
  `PipelineBuilder`, `PipelineTypes`, `PolicySubject`, `PolicyViolation`,
  `PortsConfig`, `PortsKernelOptions`, `PreOptions`, `PreResult`,
  `ReadinessStatus`, `ResolvedBundle`, `ResponseTrackInput`,
  `SNAPSHOT_VERSION`, `SchemaDescriptor`, `ServerToken`, `SharedKeyReader`,
  `SnapshotSource`, `StreamBindContext`, `SwitchFields`,
  `TopologyOperationReport`, `TransportRef`, `TransportToken`, `UnitInstance`,
  `UnitLike`, `ambientRequestId`, `assertFeatureBoundary`, `bindOutputStream`,
  `bindPorts`, `buildOwnerMap`, `canonicalizeJson`, `collectImplementations`,
  `computeOutcome`, `declaredFailsOf`, `declaresVar`, `derivesFrom`,
  `describeOperation`, `healthConfigKeys`, `healthKernel`, `injectedTokens`,
  `isTransport`, `keysGlob`, `logConfigKeys`, `modulesOf`, `portsConfigKeys`,
  `portsKernel`, `propagatedKeys`, `reachableModules`, `reachablePlugins`,
  `readSectionSnapshot`, `resolveBundle`, `resolveSelection`,
  `resourceHealthChecks`, `runInRequestScope`, `suggestBump`,
  `toRouteDeclaration`, `undurableOperations`, `withDeadline`, `withFinish`,
  `withRequestLogging`.

### `@nestling/app`: убрано 56 имён, реэкспортированных из соседей

  `AnyMultipartForm`, `AnyStreamForm`, `BindableFields`, `Category`,
  `ChainStep`, `CommandMeta`, `DeclarationDoc`, `DeclaredFail`,
  `EmitterToken`, `FailCode`, `FailCreateOptions`, `FailData`,
  `FailDefinitionProps`, `FailDefinitionWithDetails`, `FailOfDef`,
  `FailOptions`, `FailResponseOf`, `FailSpecWithDetails`,
  `FailSpecWithoutDetails`, `FilesOf`, `FormBearingDefinition`, `FormLeaf`,
  `FormSlot`, `IOPrimitive`, `InvokeArgs`, `ItemOptions`, `KernelPortFail`,
  `LeafJsonSchema`, `LeafType`, `MetaOf`, `MultipartForm`, `PortToken`,
  `ResponseLike`, `SchemaDocOptions`, `StreamFormOptions`, `StreamKind`,
  `SuccessStatus`, `UploadOptions`, `assertDoc`, `assertFailCode`,
  `assertFormSlots`, `categories`, `categoryOf`, `isCategory`,
  `isFailDefinition`, `isForm`, `isKernelFailCode`, `isStreamKind`,
  `isUploadSpec`, `jsonSchemaOf`, `makeSummary`, `nameOfForm`,
  `pickConverter`, `schemaVendorOf`, `statuses`, `successStatuses`.

### `@nestling/operations`: убрано 14 своих имён

  `CommandSpec`, `EventSpec`, `HttpOperationSection`, `InferStreamItem`,
  `OperationHttp`, `ParsedHttpSection`, `RequestSpec`, `SlowConsumerPolicy`,
  `StreamGapTimeoutError`, `StreamLimitError`, `TopicOptions`,
  `UndeclaredOperationFails`, `parseHttpSection`, `through`.

### `@nestling/operations`: убрано 1 имя соседа

  `SchemaIssue`.

Имена остались экспортами своих модулей и внутри пакета работают как
раньше: убран только реэкспорт корневым барелем. Возвращается имя одной
строкой в `src/index.ts`, когда у него появится читатель.
