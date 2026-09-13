/**
 * `@nestlingjs/app`: публичный API ядра.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Список имён —
 * это и есть граница пакета: имя, которого здесь нет, остаётся внутренним,
 * и его можно менять без ломающей правки для тех, кто установил пакет.
 * Реэкспорт соседних пакетов идёт отдельными операторами, поэтому видно,
 * что пришло из `@nestlingjs/operations` и `@nestlingjs/common.misc`, а что своё.
 *
 * Полный перечень с разбивкой по подсистемам — в README пакета.
 */

// ./config/index.js — 33
export {
  bootstrapConfig,
  Config,
  ConfigDerivedError,
  configKernel,
  ConfigKeys,
  ConfigSharedKeyError,
  ConfigValidationError,
  describeConfig,
  env,
  from,
  load,
  makeConfig,
  objectSource,
  secret,
  toBindings,
} from './config/index.js';
export type {
  ConfigBinding,
  ConfigField,
  ConfigGlob,
  ConfigInput,
  ConfigProjection,
  ConfigRecord,
  ConfigSectionToken,
  ConfigSource,
  ConfigTarget,
  ConfigValues,
  DerivedConstructor,
  DerivedField,
  DerivedRecord,
  DeriveFn,
  FromField,
  ObjectSource,
  ReloadableConfig,
  SecretField,
} from './config/index.js';

// ./health/index.js — 7
export { Health$, HealthCheck$, registerHealth } from './health/index.js';
export type {
  Health,
  HealthCheck,
  HealthReport,
  HealthStatus,
} from './health/index.js';

// ./logger/index.js — 8
export {
  logConfigKeys,
  logField,
  Logger$,
  loggerKernel,
  makeKernelLogger,
  RootLogger$,
} from './logger/index.js';
export type { LogField, LogFieldSpec } from './logger/index.js';

// ./metrics/index.js — 3
export { Metrics$, RootMetrics$ } from './metrics/index.js';
export type { MetricAttributes, Metrics } from './metrics/index.js';

// ./pipeline/index.js — 61
export {
  assertLayerFailsDeclared,
  bindInputStream,
  ClientDisconnectedError,
  collectPropagatedContext,
  compose,
  contextKernel,
  contextVar,
  ContextVarUnavailableError,
  Ctx,
  done,
  everyEndpoint,
  handlerClassOf,
  isAsyncIterable,
  isDone,
  isContextVar,
  isEndpointDefinition,
  isMidStreamFailure,
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  parseMetadata,
  parsePayload,
  RequestId,
  Signal,
  Trace,
  traceparent,
  TransportClosingError,
  transportNameOf,
  UndeclaredDoneError,
  withRequestId,
  withTracing,
} from './pipeline/index.js';
export type {
  AnyContextVar,
  AnyEndpointDefinition,
  AnyHandlerResult,
  CheckedHandlerFn,
  ContextVar,
  ContextVarDeclarator,
  ContextVarOptions,
  CtxReader,
  DeferredPreStepFn,
  Done,
  EndpointDefinition,
  EndpointFilter,
  EndpointMeta,
  EndpointOptions,
  ErrorDetails,
  ErrorResponseContext,
  ExtendableContext,
  FinallyStepFn,
  HandlerClass,
  HandlerFn,
  MissingFields,
  Outcome,
  PhasedPipeline,
  Pipeline,
  Policy,
  PreStepFn,
  PropagatedContextVar,
  Raw,
  ReadonlyContextVar,
  ResponseContext,
  SuccessResponseContext,
  TraceContext,
  StepResolver,
} from './pipeline/index.js';

// ./ports/index.js — 36
export {
  BUS_TRANSPORT_NAME,
  busBindingOf,
  BusTransport$,
  Deadline,
  deadlineFromTimeout,
  deadlineIn,
  diffOperations,
  failureResponse,
  formatCompatibility,
  Handler,
  IDEMPOTENCY_KEY_ATTRIBUTE,
  IdempotencyKey,
  implement,
  InProcessBus,
  isExhausted,
  MessageBus$,
  profileAttributes,
  serializeSnapshot,
  snapshotOperations,
  startBudget,
  withIdempotencyKey,
} from './ports/index.js';
export type {
  BusBinding,
  BusHandler,
  BusMessageMeta,
  BusSubscription,
  CompatibilityChange,
  CompatibilityReport,
  CompatibilityVerdict,
  HandlerMeta,
  IMessageBus,
  OperationDescriptor,
  OperationSnapshot,
  PublishOptions,
  RequestOptions,
  SnapshotOperation,
  SubscribeOptions,
} from './ports/index.js';

// ./root/index.js — 17
export {
  App,
  BuiltApp,
  Discovery$,
  isApp,
  makeApp,
  makeFeature,
  makePlugin,
} from './root/index.js';
export type {
  BuildArgs,
  Bundle,
  CheckOptions,
  CheckReport,
  DiscoveredEndpoint,
  EndpointDiscovery,
  Feature,
  FeatureOptions,
  Plugin,
  PluginOptions,
} from './root/index.js';

// ./transport/index.js — 14
export {
  DEFAULT_INSTANCE,
  makeDispatch,
  makeServerDeclaration,
  makeTransportDeclaration,
  transportValue,
} from './transport/index.js';
export type {
  BusDeclaration,
  Dispatch,
  DispatchOptions,
  ExecutableDeclaration,
  IListener,
  ITransport,
  RouteDeclaration,
  ServerDeclaration,
  TransportDeclaration,
} from './transport/index.js';

// @nestlingjs/common.misc — 8
export {
  assertStandardSchema,
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
  validateSync,
} from '@nestlingjs/common.misc';
export type { DomainType, SchemaIssue } from '@nestlingjs/common.misc';

// @nestlingjs/logging — 6
export { makeConsoleLogger } from '@nestlingjs/logging';
export type {
  ConsoleLoggerOptions,
  Fields,
  Logger,
  LogLevel,
  LogMethod,
} from '@nestlingjs/logging';

// @nestlingjs/operations — 45
export {
  assertConverters,
  assertFormsSupported,
  BadRequest,
  describeForm,
  events,
  Fail,
  InternalError,
  isFail,
  isPrimitiveLeaf,
  jsonSchema,
  leafJsonSchema,
  makeFail,
  mediaTypeOf,
  multipart,
  Ok,
  PayloadTooLarge,
  stream,
  Timeout,
  upload,
} from '@nestlingjs/operations';
export type {
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  Emitter,
  EmptyInput,
  FailDefinitionWithoutDetails,
  FailsOf,
  FilePart,
  FormDescriptor,
  FormKind,
  InferInput,
  InferOutput,
  Output,
  OutputSync,
  Port,
  PortMeta,
  PortResult,
  ProcessingStatus,
  SchemaDocConverter,
  StreamForm,
  StreamSummary,
  TransportCapabilities,
  UploadSpec,
  ValidateOutputForm,
} from '@nestlingjs/operations';
