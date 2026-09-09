/**
 * `@nestling/operations`: публичный API деклараций, общих для сервера и
 * клиента.
 *
 * Здесь лежит всё, из чего состоит операция: `Ok`/`Fail` и статусы,
 * определения отказов, формы io, пометки размещения и bind-карта, сам
 * `makeRequest`. Рядом — `Topic` и комбинаторы item-цепочек. Пакет не
 * импортирует серверный код, контейнер и модули Node, поэтому его можно
 * импортировать во фронтенд. Это проверяет `boundary.spec.ts`.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Список имён —
 * это и есть граница пакета: имя, которого здесь нет, остаётся внутренним.
 * Из реестра имён экспортируется только чтение: `registerOperation`
 * вызывает один `makeRequest`, а `lookupOperation` нужен рецептам семейств
 * в `@nestling/app`, которые получают параметром имя операции.
 *
 * Полный перечень с разбивкой по подсистемам — в README пакета.
 */

// ./doc.js — 2
export { assertDoc } from './doc.js';
export type { DeclarationDoc } from './doc.js';

// ./families.js — 12
export { EmitterFamily, PortFamily } from './families.js';
export type {
  CommandMeta,
  Emitter,
  EmitterToken,
  InvokeArgs,
  KernelPortFail,
  MetaOf,
  Port,
  PortMeta,
  PortResult,
  PortToken,
} from './families.js';

// ./http/index.js — 19
export {
  assertHttpPath,
  body,
  buildHttpBinding,
  computeHttpBinding,
  isBindMark,
  isHttpBinding,
  METHODS_WITHOUT_BODY,
  query,
  readPathParams,
} from './http/index.js';
export type {
  BindMap,
  BindMark,
  BindPlace,
  BindPlacement,
  ComputeHttpBindingOptions,
  HttpBinding,
  HttpMethod,
  PathParams,
  RedirectStatus,
  SseConfig,
} from './http/index.js';

// ./io/index.js — 43
export {
  assertFormSlots,
  assertFormsSupported,
  describeForm,
  events,
  isForm,
  isPrimitiveLeaf,
  isStreamKind,
  isUploadSpec,
  makeSummary,
  mediaTypeOf,
  multipart,
  nameOfForm,
  stream,
  upload,
} from './io/index.js';
export type {
  AnyInput,
  AnyMultipartForm,
  AnyOutput,
  AnyPayload,
  AnyStreamForm,
  BindableFields,
  ChainStep,
  EmptyInput,
  FilePart,
  FilesOf,
  FormBearingDefinition,
  FormDescriptor,
  FormKind,
  FormLeaf,
  FormSlot,
  InferInput,
  InferOutput,
  IOPrimitive,
  ItemOptions,
  LeafType,
  MultipartForm,
  StreamForm,
  StreamFormOptions,
  StreamKind,
  StreamSummary,
  TransportCapabilities,
  UploadOptions,
  UploadSpec,
  ValidateOutputForm,
} from './io/index.js';

// ./json-schema.js — 2
export { jsonSchema, jsonSchemaOf } from './json-schema.js';

// ./kernel-fails.js — 6
export {
  BadRequest,
  InternalError,
  isKernelFailCode,
  PayloadTooLarge,
  Timeout,
} from './kernel-fails.js';
export type { KernelFail } from './kernel-fails.js';

// ./make-fail.js — 15
export { isFailDefinition, makeFail } from './make-fail.js';
export type {
  AnyFailDefinition,
  DeclaredFail,
  FailCreateOptions,
  FailDefinitionProps,
  FailDefinitionWithDetails,
  FailDefinitionWithoutDetails,
  FailOf,
  FailOfDef,
  FailResponseOf,
  FailsOf,
  FailSpecWithDetails,
  FailSpecWithoutDetails,
  ResponseLike,
} from './make-fail.js';

// ./operation.js — 17
export { makeCommand, makeEvent, makeRequest } from './operation.js';
export type {
  AnyOperation,
  CommandOperation,
  EmittingOperation,
  EventOperation,
  InputFormOf,
  InputOf,
  Operation,
  OperationFailsOf,
  OperationKind,
  OperationSpec,
  OutputFormOf,
  OutputOf,
  RequestOperation,
  ValidateOperationFails,
} from './operation.js';

// ./output.js — 2
export type { Output, OutputSync } from './output.js';

// ./registry.js — 1
export { lookupOperation } from './registry.js';

// ./result.js — 6
export { Fail, isFail, Ok } from './result.js';
export type { AnyFail, FailData, FailOptions } from './result.js';

// ./schema-doc.js — 7
export {
  assertConverters,
  leafJsonSchema,
  pickConverter,
  schemaVendorOf,
} from './schema-doc.js';
export type {
  LeafJsonSchema,
  SchemaDocConverter,
  SchemaDocOptions,
} from './schema-doc.js';

// ./status.js — 10
export {
  assertFailCode,
  categories,
  categoryOf,
  isCategory,
  statuses,
  successStatuses,
} from './status.js';
export type {
  Category,
  FailCode,
  ProcessingStatus,
  SuccessStatus,
} from './status.js';

// ./streams/index.js — 9
export {
  batch,
  collect,
  filter,
  gapTimeout,
  limit,
  tap,
  throttle,
  Topic,
  untilAborted,
} from './streams/index.js';

// ./transport-response.js — 3
export {
  isTransportResponse,
  TRANSPORT_RESPONSE,
} from './transport-response.js';
export type { TransportResponse } from './transport-response.js';

// @common/misc — 2
export type { Schema, StandardSchemaV1 } from '@common/misc';
