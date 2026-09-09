/**
 * `@nestling/app`: публичный API ядра.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Список имён —
 * это и есть граница пакета: имя, которого здесь нет, остаётся внутренним,
 * и его можно менять без ломающей правки для тех, кто установил пакет.
 * Реэкспорт соседних пакетов идёт отдельными операторами, поэтому видно,
 * что пришло из `@nestling/operations` и `@common/misc`, а что своё.
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

// ./logger/index.js — 7
export {
  Logger$,
  loggerKernel,
  makeKernelLogger,
  RootLogger$,
} from './logger/index.js';
export type { Fields, Logger, LogLevel } from './logger/index.js';

// ./pipeline/index.js — 54
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
  everyEndpoint,
  handlerClassOf,
  isAsyncIterable,
  isEndpointDefinition,
  isMidStreamFailure,
  makeEmptyContext,
  makeEndpoint,
  makePipeline,
  parseMetadata,
  parsePayload,
  RequestId,
  Signal,
  TransportClosingError,
  transportNameOf,
  withIdentity,
  withPermissions,
  withRequestId,
} from './pipeline/index.js';
export type {
  AnyContextVar,
  AnyEndpointDefinition,
  ContextVar,
  ContextVarDeclarator,
  ContextVarOptions,
  CtxReader,
  EndpointDefinition,
  EndpointFilter,
  EndpointMeta,
  EndpointOptions,
  ErrorDetails,
  ErrorResponseContext,
  ExtendableContext,
  FinallyUnitFn,
  HandlerClass,
  HandlerFn,
  MissingFields,
  Outcome,
  PhasedPipeline,
  Pipeline,
  Policy,
  PreUnitFn,
  PropagatedContextVar,
  Raw,
  ReadonlyContextVar,
  ResponseContext,
  SuccessResponseContext,
  UnitResolver,
} from './pipeline/index.js';

// ./ports/index.js — 35
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
  AssembledApp,
  Discovery$,
  isApp,
  makeApp,
  makeFeature,
  makePlugin,
} from './root/index.js';
export type {
  AssembleArgs,
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

// ./transport/index.js — 15
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
  TransportEntry,
} from './transport/index.js';

// @common/misc — 8
export {
  assertStandardSchema,
  AsyncSchemaNotSupportedError,
  normalizeIssues,
  NotAStandardSchemaError,
  SchemaValidationError,
  validateSync,
} from '@common/misc';
export type { DomainType, SchemaIssue } from '@common/misc';

// @nestling/operations — 45
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
} from '@nestling/operations';
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
} from '@nestling/operations';
