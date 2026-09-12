# @nestlingjs/operations

Declarations shared by the server and the client: operations, failures,
`Ok`/`Fail` and statuses, io shapes, the HTTP bind map and stream
combinators. The package imports no server code, container or Node
modules, so it can be imported into the frontend. A boundary test checks
this.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/operations.md`](../../docs/en/design/operations.md),
> [`docs/en/design/streaming.md`](../../docs/en/design/streaming.md).
> Guide: [chapter 14. A neighbouring feature calls the operation](../../docs/en/guide/14-features.md),
> [chapter 13. Give the frontend the documentation and the client](../../docs/en/guide/13-openapi-and-client.md).

## Install

```bash
npm install @nestlingjs/operations
```

## Minimal example

```typescript
import { makeFail, makeRequest, query } from '@nestlingjs/operations';

export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const CreateUser = makeRequest({
  name: 'users.create', // the subject of the bus
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
  doc: { summary: 'Create user', tags: ['users'], status: 'created' },
});
```

An operation is a value: it registers nothing. It reaches the
application in two ways: `implement` from `@nestlingjs/app` implements
it, and the caller `CreateUser.caller` is injected by a DI token.

## Exports

- **Operation** ([design](../../docs/en/design/operations.md)) —
  `AnyOperation`, `assertDoc`, `CommandOperation`, `DeclarationDoc`,
  `EmitMeta`, `Emitter`, `EmitterFamily`, `EmitterToken`,
  `EmittingOperation`, `EventOperation`, `HandlerResultOf`, `InputFormOf`,
  `InputOf`, `InvokeArgs`, `KernelPortFail`, `lookupOperation`,
  `makeCommand`, `makeEvent`, `makeRequest`, `MetaOf`, `Operation`,
  `OperationFailsOf`, `OperationKind`, `OperationSpec`, `OutputFormOf`,
  `OutputOf`, `Port`, `PortFamily`, `PortMeta`, `PortResult`, `PortToken`,
  `RequestOperation`, `UndeclaredHandlerFails`, `ValidateHandlerFails`,
  `ValidateOperationFails`.
- **Result and failures** ([design](../../docs/en/design/errors.md)) —
  `AnyFail`, `AnyFailDefinition`, `assertFailCode`, `BadRequest`,
  `categories`, `Category`, `categoryOf`, `DeclaredFail`, `Fail`,
  `FailCode`, `FailCreateOptions`, `FailData`, `FailDefinitionProps`,
  `FailDefinitionWithDetails`, `FailDefinitionWithoutDetails`, `FailOf`,
  `FailOfDef`, `FailOptions`, `FailResponseOf`, `FailsOf`,
  `FailSpecWithDetails`, `FailSpecWithoutDetails`, `InternalError`,
  `isCategory`, `isFail`, `isFailDefinition`, `isKernelFailCode`,
  `KernelFail`, `makeFail`, `Ok`, `Output`, `OutputSync`,
  `PayloadTooLarge`, `ProcessingStatus`, `ResponseLike`, `statuses`,
  `SuccessStatus`, `successStatuses`, `Timeout`.
- **Io shapes** ([design](../../docs/en/design/endpoints.md)) —
  `AnyInput`, `AnyMultipartForm`, `AnyOutput`, `AnyPayload`,
  `AnyStreamForm`, `assertFormSlots`, `assertFormsSupported`,
  `BindableFields`, `ChainStep`, `describeForm`, `EmptyInput`, `events`,
  `FilePart`, `FilesOf`, `FormBearingDefinition`, `FormDescriptor`,
  `FormKind`, `FormLeaf`, `FormSlot`, `InferInput`, `InferOutput`,
  `IOPrimitive`, `isForm`, `isPrimitiveLeaf`, `isStreamKind`,
  `isUploadSpec`, `ItemOptions`, `LeafType`, `makeSummary`, `mediaTypeOf`,
  `multipart`, `MultipartForm`, `nameOfForm`, `stream`, `StreamForm`,
  `StreamFormOptions`, `StreamKind`, `StreamSummary`,
  `TransportCapabilities`, `upload`, `UploadOptions`, `UploadSpec`,
  `ValidateOutputForm`.
- **HTTP address** ([design](../../docs/en/design/transports.md)) —
  `assertHttpPath`, `BindMap`, `BindMark`, `BindPlace`, `BindPlacement`,
  `body`, `buildHttpBinding`, `computeHttpBinding`,
  `ComputeHttpBindingOptions`, `HttpBinding`, `HttpMethod`, `isBindMark`,
  `isHttpBinding`, `METHODS_WITHOUT_BODY`, `PathParams`, `query`,
  `readPathParams`, `RedirectStatus`, `SseConfig`.
- **Schemas** ([design](../../docs/en/design/schemas.md)) —
  `assertConverters`, `jsonSchema`, `jsonSchemaOf`, `leafJsonSchema`,
  `LeafJsonSchema`, `pickConverter`, `SchemaDocConverter`,
  `SchemaDocOptions`, `schemaVendorOf`.
- **Streams** ([design](../../docs/en/design/streaming.md)) — `batch`,
  `collect`, `filter`, `gapTimeout`, `limit`, `tap`, `throttle`, `Topic`,
  `untilAborted`.
- **Transport response** — `isTransportResponse`, `TRANSPORT_RESPONSE`,
  `TransportResponse`.
- **Re-export of [`@nestlingjs/common.misc`](../common.misc/)** — the
  Standard Schema types, so that the client and the documentation
  generator do not have to install the specification package.

## Package boundaries

The package describes operations and does not execute them. The
implementation, the container, the pipeline and the transports live in
`@nestlingjs/app` and the transport packages.
